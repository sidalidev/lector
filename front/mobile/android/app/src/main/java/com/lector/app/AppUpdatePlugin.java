package com.lector.app;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * In-app update without a store (like the non Play builds of Signal).
 *
 * 1. Check: GET the signed manifest from GitHub Releases. It is accepted only if its Ed25519
 *    signature is valid for the release key (the same key that signs the iOS web bundle), and
 *    if its versionCode and version are strictly greater than the installed ones.
 * 2. Download: the APK is fetched in the background, over https only, from github.com and the
 *    GitHub download hosts (checked on every redirect), then rejected unless its SHA-256, package
 *    name, versionCode and signing certificate match the manifest and the installed app.
 * 3. Install: on the user's tap, through PackageInstaller. The system confirmation screen is
 *    always shown: nothing installs without the user.
 *
 * Manifest: {"version","versionCode","url","sha256","certSha256","signature"}, signature over
 * "lector-android-apk|version|versionCode|sha256|certSha256|url" (see tools/release-android.mjs).
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String TAG = "LectorUpdate";
    static final String ACTION_RESULT = "com.lector.app.action.UPDATE_INSTALL_RESULT";

    private static final String MANIFEST_URL = "https://github.com/sidalidev/lector/releases/latest/download/lector-android.json";
    /** Ed25519 public key of the release signing key (also embedded in OTAUpdatePlugin.swift). */
    private static final String PUBLIC_KEY_BASE64 = "YsRwje0BMU6Cx2hKZmtYMqbaxDglgAB6bJ61URROnGU=";
    private static final String SIGNED_PREFIX = "lector-android-apk|";
    /** GitHub serves release assets from github.com, then redirects to one of its download hosts. */
    private static final Set<String> ALLOWED_HOSTS = new HashSet<>(Arrays.asList(
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com"
    ));
    private static final String RELEASE_PATH = "/sidalidev/lector/releases/";

    private static final int MAX_MANIFEST_BYTES = 16 * 1024;
    private static final long MAX_APK_BYTES = 200L * 1024 * 1024;
    private static final int MAX_REDIRECTS = 5;

    private static final Pattern HEX64 = Pattern.compile("^[0-9a-f]{64}$");
    private static final Pattern VERSION = Pattern.compile("^\\d+(\\.\\d+){0,3}$");

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile boolean busy = false;

    /** Verified APK waiting for the user's tap (survives only while the process lives). */
    private static volatile File readyApk;
    private static volatile String readyVersion;

    private static final class Manifest {
        String version;
        long versionCode;
        String url;
        String sha256;
        String certSha256;
    }

    private static final class Refused extends Exception {
        Refused(String message) { super(message); }
    }

    @Override
    public void load() {
        executor.execute(this::cleanStaleDownloads);
    }

    @PluginMethod
    public void checkForUpdate(PluginCall call) {
        if (busy) {
            call.reject("busy");
            return;
        }
        busy = true;
        executor.execute(() -> {
            try {
                JSObject ret = new JSObject();
                ret.put("currentVersion", installedVersionName());
                Manifest m = fetchManifest();
                if (m == null) {
                    ret.put("updateAvailable", false);
                    call.resolve(ret);
                    return;
                }
                File apk = readyApk;
                if (apk == null || !apk.isFile() || !m.version.equals(readyVersion)) {
                    apk = download(m);
                    verifyApk(m, apk);
                    readyApk = apk;
                    readyVersion = m.version;
                }
                Log.i(TAG, "Update " + m.version + " (" + m.versionCode + ") verified and ready");
                ret.put("updateAvailable", true);
                ret.put("ready", true);
                ret.put("version", m.version);
                call.resolve(ret);
            } catch (Refused e) {
                Log.w(TAG, "Update refused: " + e.getMessage());
                call.reject("refused");
            } catch (IOException e) {
                // Offline or GitHub unreachable: nothing to tell the user.
                call.reject("offline");
            } catch (Exception e) {
                Log.w(TAG, "Update check failed: " + e.getMessage());
                call.reject("failed");
            } finally {
                busy = false;
            }
        });
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        Context ctx = getContext();
        File apk = readyApk;
        if (apk == null || !apk.isFile()) {
            call.reject("No update ready");
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
            // "Install unknown apps" is off for Lector: open the system screen, the banner stays.
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(settings);
            JSObject ret = new JSObject();
            ret.put("needsPermission", true);
            call.resolve(ret);
            return;
        }
        executor.execute(() -> {
            try {
                install(ctx, apk);
                JSObject ret = new JSObject();
                ret.put("started", true);
                call.resolve(ret);
            } catch (Exception e) {
                Log.w(TAG, "Install failed: " + e.getMessage());
                call.reject("Install failed");
            }
        });
    }

    @PluginMethod
    public void getCurrentVersion(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("version", installedVersionName());
        ret.put("versionCode", installedVersionCode());
        call.resolve(ret);
    }

    // --- Manifest ---

    /** Signed, newer manifest, or null when the app is up to date or no release exists yet. */
    private Manifest fetchManifest() throws IOException, Refused {
        byte[] body;
        try {
            body = get(MANIFEST_URL, MAX_MANIFEST_BYTES);
        } catch (NotFound e) {
            return null;
        }
        Manifest m;
        String signature;
        try {
            JSONObject j = new JSONObject(new String(body, StandardCharsets.UTF_8));
            m = new Manifest();
            m.version = j.getString("version");
            m.versionCode = j.getLong("versionCode");
            m.url = j.getString("url");
            m.sha256 = j.getString("sha256");
            m.certSha256 = j.getString("certSha256");
            signature = j.getString("signature");
        } catch (Exception e) {
            throw new Refused("malformed manifest");
        }
        if (!VERSION.matcher(m.version).matches() || m.versionCode <= 0) throw new Refused("bad version");
        if (!HEX64.matcher(m.sha256).matches() || !HEX64.matcher(m.certSha256).matches()) throw new Refused("bad digest");
        if (!isAllowedUrl(m.url, true)) throw new Refused("url not allowed");

        byte[] sig;
        try {
            sig = Base64.decode(signature, Base64.NO_WRAP);
        } catch (IllegalArgumentException e) {
            throw new Refused("bad signature encoding");
        }
        byte[] key = Base64.decode(PUBLIC_KEY_BASE64, Base64.NO_WRAP);
        if (!Ed25519.verify(key, signedMessage(m).getBytes(StandardCharsets.UTF_8), sig)) {
            throw new Refused("invalid signature");
        }

        if (m.versionCode <= installedVersionCode()) return null;
        if (compareVersions(m.version, installedVersionName()) <= 0) return null;
        return m;
    }

    static String signedMessage(Manifest m) {
        return SIGNED_PREFIX + m.version + "|" + m.versionCode + "|" + m.sha256 + "|" + m.certSha256 + "|" + m.url;
    }

    /** "2.10.0" > "2.9.3"; missing parts count as 0. */
    static int compareVersions(String a, String b) {
        String[] pa = a.split("\\."), pb = b.split("[.\\-+]");
        for (int i = 0; i < Math.max(pa.length, pb.length); i++) {
            long x = i < pa.length ? parsePart(pa[i]) : 0;
            long y = i < pb.length ? parsePart(pb[i]) : 0;
            if (x != y) return x < y ? -1 : 1;
        }
        return 0;
    }

    private static long parsePart(String s) {
        try { return Long.parseLong(s.replaceAll("\\D.*$", "")); } catch (NumberFormatException e) { return 0; }
    }

    /** https, a GitHub host, and (for the signed APK url) the Lector releases path. */
    private static boolean isAllowedUrl(String s, boolean releasePath) {
        try {
            URL u = new URL(s);
            if (!"https".equals(u.getProtocol())) return false;
            if (u.getUserInfo() != null || (u.getPort() != -1 && u.getPort() != 443)) return false;
            String host = u.getHost().toLowerCase(Locale.ROOT);
            if (!ALLOWED_HOSTS.contains(host)) return false;
            if (releasePath) return host.equals("github.com") && u.getPath().startsWith(RELEASE_PATH) && u.getRef() == null;
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    // --- Network ---

    private static final class NotFound extends IOException {}

    /** Opens a GET that follows redirects by hand, checking every hop against the allowed hosts. */
    private static HttpURLConnection open(String start) throws IOException, Refused {
        String current = start;
        for (int i = 0; i <= MAX_REDIRECTS; i++) {
            if (!isAllowedUrl(current, false)) throw new Refused("host not allowed");
            HttpURLConnection c = (HttpURLConnection) new URL(current).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("Cache-Control", "no-cache");
            c.setRequestProperty("User-Agent", "Lector-Android");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String location = c.getHeaderField("Location");
                c.disconnect();
                if (location == null) throw new IOException("redirect without location");
                current = new URL(new URL(current), location).toString();
                continue;
            }
            if (code == 404) {
                c.disconnect();
                throw new NotFound();
            }
            if (code != 200) {
                c.disconnect();
                throw new IOException("HTTP " + code);
            }
            return c;
        }
        throw new IOException("too many redirects");
    }

    private static byte[] get(String url, int maxBytes) throws IOException, Refused {
        HttpURLConnection c = open(url);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) >= 0) {
                if (out.size() + n > maxBytes) throw new Refused("response too large");
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        } finally {
            c.disconnect();
        }
    }

    // --- APK ---

    private File updateDir() {
        return new File(getContext().getCacheDir(), "update");
    }

    private File download(Manifest m) throws IOException, Refused {
        File dir = updateDir();
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("cannot create cache dir");
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
        File apk = new File(dir, "lector-" + m.versionCode + ".apk");
        HttpURLConnection c = open(m.url);
        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
            long len = c.getContentLengthLong();
            if (len > MAX_APK_BYTES) throw new Refused("APK too large");
            byte[] buf = new byte[64 * 1024];
            long total = 0;
            int n;
            while ((n = in.read(buf)) >= 0) {
                total += n;
                if (total > MAX_APK_BYTES) throw new Refused("APK too large");
                out.write(buf, 0, n);
            }
        } catch (IOException | Refused e) {
            apk.delete();
            throw e;
        } finally {
            c.disconnect();
        }
        return apk;
    }

    /** SHA-256, package, versionCode, then signing certificates: same as installed and as announced. */
    private void verifyApk(Manifest m, File apk) throws Refused {
        try {
            if (!MessageDigest.isEqual(sha256Hex(apk).getBytes(StandardCharsets.US_ASCII), m.sha256.getBytes(StandardCharsets.US_ASCII))) {
                throw new Refused("SHA-256 differs from the manifest");
            }
            PackageManager pm = getContext().getPackageManager();
            PackageInfo archive = archiveInfo(pm, apk);
            if (archive == null) throw new Refused("APK unreadable");
            if (!getContext().getPackageName().equals(archive.packageName)) throw new Refused("other package");
            if (versionCodeOf(archive) != m.versionCode) throw new Refused("versionCode differs from the manifest");
            Set<String> apkCerts = certDigests(archive);
            Set<String> installedCerts = certDigests(installedInfo(pm));
            if (apkCerts.isEmpty() || !apkCerts.equals(installedCerts)) throw new Refused("certificate differs from the installed app");
            if (!apkCerts.contains(m.certSha256)) throw new Refused("certificate differs from the manifest");
        } catch (Refused e) {
            apk.delete();
            throw e;
        } catch (Exception e) {
            apk.delete();
            throw new Refused("verification failed: " + e.getMessage());
        }
    }

    @SuppressWarnings("deprecation")
    private static PackageInfo archiveInfo(PackageManager pm, File apk) {
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        return pm.getPackageArchiveInfo(apk.getPath(), flags);
    }

    @SuppressWarnings("deprecation")
    private PackageInfo installedInfo(PackageManager pm) throws PackageManager.NameNotFoundException {
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        return pm.getPackageInfo(getContext().getPackageName(), flags);
    }

    @SuppressWarnings("deprecation")
    private static Set<String> certDigests(PackageInfo info) throws Exception {
        Signature[] sigs;
        if (Build.VERSION.SDK_INT >= 28) {
            sigs = info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
        } else {
            sigs = info.signatures;
        }
        Set<String> out = new HashSet<>();
        if (sigs == null) return out;
        for (Signature s : sigs) out.add(hex(MessageDigest.getInstance("SHA-256").digest(s.toByteArray())));
        return out;
    }

    @SuppressWarnings("deprecation")
    private static long versionCodeOf(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    private long installedVersionCode() {
        try {
            return versionCodeOf(getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0));
        } catch (Exception e) {
            return Long.MAX_VALUE;
        }
    }

    private String installedVersionName() {
        try {
            String v = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName;
            return v == null ? "0" : v;
        } catch (Exception e) {
            return "0";
        }
    }

    private static String sha256Hex(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) >= 0) md.update(buf, 0, n);
        }
        return hex(md.digest());
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        return sb.toString();
    }

    /** Leftover downloads from an update that is now installed (or older). */
    private void cleanStaleDownloads() {
        File[] files = updateDir().listFiles();
        if (files == null) return;
        long installed = installedVersionCode();
        for (File f : files) {
            String name = f.getName();
            long code = -1;
            if (name.startsWith("lector-") && name.endsWith(".apk")) {
                code = parsePart(name.substring(7, name.length() - 4));
            }
            if (code <= installed && !f.equals(readyApk)) f.delete();
        }
    }

    // --- Install ---

    private static void install(Context ctx, File apk) throws IOException {
        PackageInstaller installer = ctx.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(ctx.getPackageName());
        params.setSize(apk.length());
        if (Build.VERSION.SDK_INT >= 31) {
            // Always the system confirmation screen: nothing installs without the user.
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
        }
        int sessionId = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            try (OutputStream out = session.openWrite("lector.apk", 0, apk.length()); InputStream in = new FileInputStream(apk)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
                session.fsync(out);
            }
            Intent result = new Intent(ctx, AppUpdateInstallReceiver.class).setAction(ACTION_RESULT);
            // Mutable: PackageInstaller adds the status and the confirmation intent (explicit intent).
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, sessionId, result, flags);
            session.commit(pi.getIntentSender());
        } catch (IOException | RuntimeException e) {
            try { installer.abandonSession(sessionId); } catch (Exception ignored) { }
            throw e;
        }
    }

    /** Called by AppUpdateInstallReceiver once the install succeeded or failed for good. */
    static void onInstallFinished(boolean keepForRetry) {
        if (keepForRetry) return;
        File apk = readyApk;
        readyApk = null;
        readyVersion = null;
        if (apk != null) apk.delete();
    }
}
