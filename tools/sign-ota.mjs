#!/usr/bin/env node
// Signs Lector update manifests with Ed25519 (one release key for iOS and Android).
//
// iOS web bundle:
//   node tools/sign-ota.mjs <zip> <version> <url> <out.json>
//   The app accepts a bundle only if the signature over "lector-ios-ota|<version>|<sha256>" is valid
//   and the downloaded zip matches <sha256>.
//
// Android APK: see tools/release-android.mjs, which builds the manifest and calls signAndroidManifest().
//   Signed message: "lector-android-apk|<version>|<versionCode>|<sha256>|<certSha256>|<url>".
//
// Private key: $LECTOR_OTA_KEY or ~/.lector/ota-ed25519.pem (never in the repo).
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION_RE = /^\d+(\.\d+){0,3}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
/** The Android app only downloads from the Lector releases on GitHub. */
export const ANDROID_URL_PREFIX = 'https://github.com/sidalidev/lector/releases/';

function loadKey() {
  const keyPath = process.env.LECTOR_OTA_KEY || join(homedir(), '.lector', 'ota-ed25519.pem');
  return createPrivateKey(readFileSync(keyPath));
}

/** Raw 32-byte public key, base64 (the value embedded in the apps). */
export function publicKeyBase64(key = loadKey()) {
  return createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
}

export function androidSignedMessage({ version, versionCode, sha256, certSha256, url }) {
  return `lector-android-apk|${version}|${versionCode}|${sha256}|${certSha256}|${url}`;
}

/** Validates the fields and returns the manifest with its signature, as published next to the APK. */
export function signAndroidManifest({ version, versionCode, sha256, certSha256, url }) {
  if (!VERSION_RE.test(version)) throw new Error(`invalid version: ${version}`);
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0) throw new Error(`invalid versionCode: ${versionCode}`);
  if (!HEX64_RE.test(sha256)) throw new Error('invalid sha256');
  if (!HEX64_RE.test(certSha256)) throw new Error('invalid certSha256');
  if (!url.startsWith(ANDROID_URL_PREFIX) || /[\s#]/.test(url)) throw new Error(`url not allowed: ${url}`);
  const key = loadKey();
  const fields = { version, versionCode, url, sha256, certSha256 };
  const signature = sign(null, Buffer.from(androidSignedMessage(fields)), key).toString('base64');
  return { manifest: { ...fields, signature }, publicKey: publicKeyBase64(key) };
}

function signIos(zip, version, url, out) {
  if (!VERSION_RE.test(version)) throw new Error(`invalid version: ${version}`);
  if (!url.startsWith('https://lector.dockerbop.fr/')) throw new Error(`url not allowed: ${url}`);
  const key = loadKey();
  const sha256 = createHash('sha256').update(readFileSync(zip)).digest('hex');
  const signature = sign(null, Buffer.from(`lector-ios-ota|${version}|${sha256}`), key).toString('base64');
  writeFileSync(out, JSON.stringify({ version, url, sha256, signature }) + '\n');
  console.log(`signed v${version} sha256=${sha256.slice(0, 12)}… key=${publicKeyBase64(key)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [zip, version, url, out] = process.argv.slice(2);
  if (!zip || !version || !url || !out) {
    console.error('usage: sign-ota.mjs <zip> <version> <url> <out.json>');
    process.exit(1);
  }
  signIos(zip, version, url, out);
}
