#!/usr/bin/env node
// Builds the signed update manifest for a release APK of the Android app.
//
// Usage: node tools/release-android.mjs <app-release.apk> [out-dir]
//
// Reads versionName and versionCode from the APK (aapt2), its signing certificate (apksigner),
// checks that certificate against the release keystore, then writes into out-dir (default
// release/android/):
//   lector-<version>.apk     the APK, renamed
//   lector-android.json      {version, versionCode, url, sha256, certSha256, signature}
// Both files go on the GitHub release v<version> of sidalidev/lector. The app reads
// .../releases/latest/download/lector-android.json and downloads the APK from the url inside.
//
// Keystore: $LECTOR_KEYSTORE or ~/.lector/lector-github.keystore (the GitHub/Obtainium signing
// key, see docs/security/CLES.md), with keyAlias and storePassword from
// $LECTOR_KEYSTORE_PROPERTIES or ~/.lector/keystore-github.properties. Google Play builds use
// another key (lector-release.keystore) and do not go through this script.
// The password only goes to keytool through its environment, it is never printed.
// Ed25519 key: see tools/sign-ota.mjs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ANDROID_URL_PREFIX, signAndroidManifest } from './sign-ota.mjs';

const PACKAGE = 'com.lector.app';

function die(message) {
  console.error(`release-android: ${message}`);
  process.exit(1);
}

function buildTool(name) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(homedir(), 'Library', 'Android', 'sdk');
  const dir = join(sdk, 'build-tools');
  if (!existsSync(dir)) die(`Android build-tools not found in ${sdk} (set ANDROID_HOME)`);
  const versions = readdirSync(dir)
    .filter((v) => existsSync(join(dir, v, name)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!versions.length) die(`${name} not found in ${dir}`);
  return join(dir, versions[versions.length - 1], name);
}

function readProperties(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([^#!=\s][^=]*?)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** SHA-256 of the release certificate, lowercase hex without colons. */
function keystoreCertSha256() {
  const keystore = process.env.LECTOR_KEYSTORE || join(homedir(), '.lector', 'lector-github.keystore');
  const propsPath = process.env.LECTOR_KEYSTORE_PROPERTIES || join(homedir(), '.lector', 'keystore-github.properties');
  if (!existsSync(keystore)) die(`keystore not found: ${keystore}`);
  if (!existsSync(propsPath)) die(`keystore properties not found: ${propsPath}`);
  const props = readProperties(propsPath);
  if (!props.keyAlias || !props.storePassword) die(`keyAlias or storePassword missing in ${propsPath}`);
  let text;
  try {
    text = execFileSync(
      'keytool',
      ['-list', '-v', '-keystore', keystore, '-alias', props.keyAlias, '-storepass:env', 'LECTOR_KS_PASS'],
      { env: { ...process.env, LECTOR_KS_PASS: props.storePassword }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch {
    die('keytool could not read the release keystore (wrong alias or password?)');
  }
  const m = text.match(/SHA256:\s*([0-9A-Fa-f:]{95})/);
  if (!m) die('no SHA-256 fingerprint in the keytool output');
  return m[1].replace(/:/g, '').toLowerCase();
}

const [apkArg, outArg] = process.argv.slice(2);
if (!apkArg) die('usage: release-android.mjs <app-release.apk> [out-dir]');
const apk = resolve(apkArg);
if (!existsSync(apk)) die(`APK not found: ${apk}`);

// Version from the APK itself, so the manifest cannot drift from what is published.
const badging = execFileSync(buildTool('aapt2'), ['dump', 'badging', apk], { encoding: 'utf8' });
const pkg = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
if (!pkg) die('cannot read the package line from aapt2');
const [, packageName, versionCodeText, version] = pkg;
if (packageName !== PACKAGE) die(`unexpected package ${packageName}`);
const versionCode = Number(versionCodeText);

// Signing certificate of the APK: exactly one signer, the release key.
let certs;
try {
  certs = execFileSync(buildTool('apksigner'), ['verify', '--print-certs', apk], { encoding: 'utf8' });
} catch {
  die('apksigner could not verify the APK signature (is it a signed release build?)');
}
const digests = [...certs.matchAll(/certificate SHA-256 digest:\s*([0-9a-f]{64})/g)].map((m) => m[1]);
if (digests.length !== 1) die(`expected one signer, found ${digests.length}`);
const certSha256 = digests[0];
if (certSha256 !== keystoreCertSha256()) die('APK is not signed with the release keystore');

const sha256 = createHash('sha256').update(readFileSync(apk)).digest('hex');
const fileName = `lector-${version}.apk`;
const url = `${ANDROID_URL_PREFIX}download/v${version}/${fileName}`;
const { manifest, publicKey } = signAndroidManifest({ version, versionCode, sha256, certSha256, url });

const outDir = resolve(outArg || 'release/android');
mkdirSync(outDir, { recursive: true });
copyFileSync(apk, join(outDir, fileName));
writeFileSync(join(outDir, 'lector-android.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`Lector ${version} (${versionCode}) sha256=${sha256.slice(0, 12)}… cert=${certSha256.slice(0, 12)}… key=${publicKey}`);
console.log(`Written to ${outDir}: ${fileName}, lector-android.json`);
console.log(`Publish both on the release v${version}, for example:`);
console.log(`  gh release create v${version} --repo sidalidev/lector ${join(outDir, fileName)} ${join(outDir, 'lector-android.json')}`);
