# Signing keys

Every key that can make a device trust a Lector build or update. No secret is in this file or in the repository: only roles, public fingerprints and where the private copies are kept.

## Android, GitHub Releases and Obtainium

- File: `~/.lector/lector-github.keystore` (PKCS12, alias `lector`, RSA 4096, created 2026-11-01, valid until 2056-10-24).
- Passwords: `~/.lector/keystore-github.properties` (same format as `front/mobile/android/keystore.properties.example`), generated at random with openssl.
- Role: signs every APK published on GitHub Releases. The in-app updater refuses an APK whose certificate differs from the installed app's.
- Used by: `front/mobile/android/keystore.properties` (not versioned, points to this keystore) and `tools/release-android.mjs` (default keystore, overridable with `LECTOR_KEYSTORE` and `LECTOR_KEYSTORE_PROPERTIES`).
- Certificate SHA-256:

```
3A:E2:08:E2:8C:15:17:3D:5D:FF:1A:43:3C:73:FA:A2:61:57:56:1F:8D:A5:41:1D:6A:53:EB:39:C4:EB:AE:BD
```

## Android, Google Play

- File: `~/.lector/lector-release.keystore` (alias `lector`, RSA 2048, created 2026-03-08), passwords in `~/.lector/keystore.properties`.
- Role: upload key for Google Play builds only. Never used for GitHub builds, so a leak of one key does not compromise the other channel.
- Certificate SHA-256:

```
51:DB:4A:89:70:38:B7:4D:F7:BD:FD:DC:4E:28:A8:EF:D1:B2:D3:EB:72:18:D5:80:AC:50:E2:7D:02:1C:5A:14
```

## Update manifests (Android and iOS)

- File: `~/.lector/ota-ed25519.pem` (Ed25519 private key).
- Role: signs `lector-android.json` (Android updater) and the iOS web bundle manifest. The public key is embedded in `AppUpdatePlugin.java` and `OTAUpdatePlugin.swift`.
- SHA-256 of the raw public key:

```
97c723302827ad3191e490dcb70e4f5328d1d53795ef47e4b24bb5b2581670bc
```

## macOS

- Apple Developer ID, team `AFZ3KWB56Q`, kept in the release machine's keychain. Not a file in `~/.lector/`.

## Where the copies are

- Working copy: `~/.lector/` on the release machine, folder `700`, files `600`.
- Backup: the owner's encrypted cloud storage, in the keys folder for Lector.

Nothing else holds them: not the repository, not CI, not the server.

## Checking a fingerprint

```sh
# keystore (asks for the store password)
keytool -list -v -keystore ~/.lector/lector-github.keystore -alias lector | grep SHA256
# published APK
apksigner verify --print-certs lector-<version>.apk
# update key
openssl pkey -in ~/.lector/ota-ed25519.pem -pubout -outform DER | tail -c 32 | shasum -a 256
```

## Rotating a key

An Android signing key cannot be replaced silently: Android refuses an update signed by another certificate.

1. GitHub key (compromised or lost): generate a new keystore (`keytool -genkeypair -storetype PKCS12 -keyalg RSA -keysize 4096 -validity 10950 -alias lector`), passwords from `openssl rand`. Either sign the next release with APK Signature Scheme v3 key rotation (`apksigner rotate` then `apksigner sign --lineage`) so installed apps accept it, or, if the old key is lost, announce that users must uninstall and reinstall. Update `SECURITY.md`, this file and both copies, then follow the incident procedure in `SECURITY.md`.
2. Google Play key: request an upload key reset in the Play Console. App signing by Google Play is unaffected.
3. Update key (Ed25519): generate a new key with `openssl genpkey -algorithm ed25519`, ship a release that embeds the new public key (signed with the old one while it is still trusted), then retire the old key. Update `SECURITY.md` and this file.
4. In every case: replace the copies in `~/.lector/` and in the backup, and delete the old private key only once no channel still needs it.
