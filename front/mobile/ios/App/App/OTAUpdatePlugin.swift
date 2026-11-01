import Foundation
import CryptoKit
import Capacitor
import zlib

@objc(OTAUpdatePlugin)
public class OTAUpdatePlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier: String = "OTAUpdatePlugin"
    public let jsName: String = "OTAUpdate"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkForUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "applyUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrentVersion", returnType: CAPPluginReturnPromise)
    ]

    private let updateURL = "https://lector.dockerbop.fr/api/latest-ios.json"
    /// Ed25519 public key of the OTA signing key. The private key never leaves the release machine.
    /// A bundle is installed only if the manifest is signed by this key and the zip matches its SHA-256.
    private let otaPublicKeyBase64 = "YsRwje0BMU6Cx2hKZmtYMqbaxDglgAB6bJ61URROnGU="
    private let allowedHost = "lector.dockerbop.fr"
    private let currentVersionKey = "ota-current-version"

    private var otaDir: URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return appSupport.appendingPathComponent("ota-update")
    }

    private var otaIndexHTML: URL {
        return otaDir.appendingPathComponent("dist/index.html")
    }

    /// Version of the embedded bundle (from Info.plist CFBundleShortVersionString)
    private var embeddedVersion: String {
        return Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }

    /// Currently active version (OTA or embedded)
    private var currentVersion: String {
        return UserDefaults.standard.string(forKey: currentVersionKey) ?? embeddedVersion
    }

    // MARK: - Boot: load OTA bundle if available

    public override func load() {
        print("OTAUpdatePlugin loaded, current version: \(currentVersion)")
        loadOTABundleIfAvailable()
    }

    private func loadOTABundleIfAvailable() {
        let fm = FileManager.default
        guard fm.fileExists(atPath: otaIndexHTML.path) else {
            print("OTA: No OTA bundle found, using embedded bundle")
            return
        }

        let otaVersion = UserDefaults.standard.string(forKey: currentVersionKey) ?? ""
        guard !otaVersion.isEmpty, isVersion(otaVersion, newerThan: embeddedVersion) else {
            print("OTA: OTA version (\(otaVersion)) is not newer than embedded (\(embeddedVersion)), skipping")
            return
        }

        print("OTA: Loading OTA bundle v\(otaVersion)")
        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  let webView = self.bridge?.webView else { return }
            let otaDir = self.otaDir.appendingPathComponent("dist")
            webView.loadFileURL(self.otaIndexHTML, allowingReadAccessTo: otaDir)
        }
    }

    // MARK: - Plugin Methods

    @objc public func checkForUpdate(_ call: CAPPluginCall) {
        guard let url = URL(string: updateURL) else {
            call.reject("Invalid update URL")
            return
        }

        let task = URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            guard let self = self else { return }

            if let error = error {
                call.reject("Network error: \(error.localizedDescription)")
                return
            }

            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let remoteVersion = json["version"] as? String,
                  let downloadURL = json["url"] as? String else {
                call.reject("Invalid response from update server")
                return
            }

            let updateAvailable = self.isVersion(remoteVersion, newerThan: self.currentVersion)

            call.resolve([
                "updateAvailable": updateAvailable,
                "version": remoteVersion,
                "url": downloadURL,
                "currentVersion": self.currentVersion
            ])
        }
        task.resume()
    }

    /// Downloads, verifies and extracts the latest bundle. The manifest is fetched again here and
    /// verified natively: values passed from JavaScript are ignored, so a compromised page or network
    /// cannot point the app to another bundle.
    @objc public func downloadUpdate(_ call: CAPPluginCall) {
        guard let manifestURL = URL(string: updateURL) else {
            call.reject("Invalid update URL")
            return
        }
        URLSession.shared.dataTask(with: manifestURL) { [weak self] data, _, error in
            guard let self = self else { return }
            guard error == nil, let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let version = json["version"] as? String,
                  let urlString = json["url"] as? String,
                  let sha256 = (json["sha256"] as? String)?.lowercased(),
                  let signature = json["signature"] as? String else {
                call.reject("Unsigned or invalid update manifest refused")
                return
            }
            guard self.verifySignature(version: version, sha256: sha256, signatureBase64: signature) else {
                call.reject("Update signature invalid, refused")
                return
            }
            guard self.isVersion(version, newerThan: self.currentVersion) else {
                call.reject("Update is not newer than the installed version")
                return
            }
            guard let url = URL(string: urlString), url.scheme == "https", url.host == self.allowedHost else {
                call.reject("Update URL not allowed")
                return
            }
            self.downloadVerified(url: url, version: version, sha256: sha256, call: call)
        }.resume()
    }

    private func verifySignature(version: String, sha256: String, signatureBase64: String) -> Bool {
        guard sha256.count == 64, sha256.allSatisfy({ $0.isHexDigit }),
              let keyData = Data(base64Encoded: otaPublicKeyBase64),
              let sig = Data(base64Encoded: signatureBase64),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData) else { return false }
        let message = Data("lector-ios-ota|\(version)|\(sha256)".utf8)
        return key.isValidSignature(sig, for: message)
    }

    private func downloadVerified(url: URL, version: String, sha256: String, call: CAPPluginCall) {
        let task = URLSession.shared.downloadTask(with: url) { [weak self] tempURL, _, error in
            guard let self = self else { return }
            if let error = error {
                call.reject("Download failed: \(error.localizedDescription)")
                return
            }
            guard let tempURL = tempURL, let zipData = try? Data(contentsOf: tempURL) else {
                call.reject("Download failed: no file")
                return
            }
            let digest = SHA256.hash(data: zipData).map { String(format: "%02x", $0) }.joined()
            guard digest == sha256 else {
                call.reject("Downloaded bundle does not match the signed checksum, refused")
                return
            }

            let fm = FileManager.default
            do {
                if fm.fileExists(atPath: self.otaDir.path) {
                    try fm.removeItem(at: self.otaDir)
                }
                try fm.createDirectory(at: self.otaDir, withIntermediateDirectories: true)
                let zipPath = self.otaDir.appendingPathComponent("update.zip")
                try zipData.write(to: zipPath)
                try self.unzip(zipPath, to: self.otaDir)
                try? fm.removeItem(at: zipPath)

                guard fm.fileExists(atPath: self.otaIndexHTML.path) else {
                    try? fm.removeItem(at: self.otaDir)
                    call.reject("Invalid bundle: index.html not found")
                    return
                }
                UserDefaults.standard.set(version, forKey: self.currentVersionKey)
                print("OTA: Verified, downloaded and extracted v\(version)")
                call.resolve(["success": true])
            } catch {
                try? fm.removeItem(at: self.otaDir)
                call.reject("Extraction failed: \(error.localizedDescription)")
            }
        }
        task.resume()
    }

    @objc public func applyUpdate(_ call: CAPPluginCall) {
        let fm = FileManager.default

        guard fm.fileExists(atPath: otaIndexHTML.path) else {
            call.reject("No OTA bundle to apply")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  let webView = self.bridge?.webView else {
                call.reject("WebView not available")
                return
            }

            let otaDistDir = self.otaDir.appendingPathComponent("dist")
            webView.loadFileURL(self.otaIndexHTML, allowingReadAccessTo: otaDistDir)
            print("OTA: Applied update, reloading WebView")
            call.resolve(["success": true])
        }
    }

    @objc public func getCurrentVersion(_ call: CAPPluginCall) {
        call.resolve([
            "version": currentVersion,
            "embeddedVersion": embeddedVersion
        ])
    }

    // MARK: - Helpers

    /// Compare semver strings: returns true if `a` is newer than `b`
    private func isVersion(_ a: String, newerThan b: String) -> Bool {
        let partsA = a.split(separator: ".").compactMap { Int($0) }
        let partsB = b.split(separator: ".").compactMap { Int($0) }

        for i in 0..<max(partsA.count, partsB.count) {
            let va = i < partsA.count ? partsA[i] : 0
            let vb = i < partsB.count ? partsB[i] : 0
            if va > vb { return true }
            if va < vb { return false }
        }
        return false
    }

    /// Unzip a ZIP file using built-in POSIX/zlib APIs (no external dependencies)
    /// Uses the minizip-compatible approach via raw file reading + Compression framework
    private func unzip(_ zipURL: URL, to destURL: URL) throws {
        // Read the entire ZIP into memory
        let zipData = try Data(contentsOf: zipURL)
        let fm = FileManager.default

        // Parse ZIP file entries (local file headers)
        var offset = 0
        let bytes = [UInt8](zipData)
        let count = bytes.count

        while offset + 30 <= count {
            // Check local file header signature: 0x04034b50
            guard bytes[offset] == 0x50, bytes[offset+1] == 0x4b,
                  bytes[offset+2] == 0x03, bytes[offset+3] == 0x04 else {
                break
            }

            let compressionMethod = UInt16(bytes[offset+8]) | (UInt16(bytes[offset+9]) << 8)
            let compressedSize = Int(UInt32(bytes[offset+18]) | (UInt32(bytes[offset+19]) << 8) | (UInt32(bytes[offset+20]) << 16) | (UInt32(bytes[offset+21]) << 24))
            let uncompressedSize = Int(UInt32(bytes[offset+22]) | (UInt32(bytes[offset+23]) << 8) | (UInt32(bytes[offset+24]) << 16) | (UInt32(bytes[offset+25]) << 24))
            let fileNameLength = Int(UInt16(bytes[offset+26]) | (UInt16(bytes[offset+27]) << 8))
            let extraFieldLength = Int(UInt16(bytes[offset+28]) | (UInt16(bytes[offset+29]) << 8))

            let fileNameStart = offset + 30
            guard fileNameStart + fileNameLength <= count else { break }
            let fileName = String(bytes: Array(bytes[fileNameStart..<fileNameStart+fileNameLength]), encoding: .utf8) ?? ""

            let dataStart = fileNameStart + fileNameLength + extraFieldLength
            guard dataStart + compressedSize <= count else { break }

            // Refuse absolute paths and ".." components: nothing may be written outside the OTA folder.
            let parts = fileName.split(separator: "/", omittingEmptySubsequences: false)
            if fileName.hasPrefix("/") || fileName.contains("\\") || parts.contains("..") {
                throw NSError(domain: "OTAUpdate", code: -2, userInfo: [NSLocalizedDescriptionKey: "Unsafe path in bundle: \(fileName)"])
            }
            let entryURL = destURL.appendingPathComponent(fileName)
            guard entryURL.standardizedFileURL.path.hasPrefix(destURL.standardizedFileURL.path + "/") else {
                throw NSError(domain: "OTAUpdate", code: -2, userInfo: [NSLocalizedDescriptionKey: "Unsafe path in bundle: \(fileName)"])
            }

            if fileName.hasSuffix("/") {
                // Directory entry
                try fm.createDirectory(at: entryURL, withIntermediateDirectories: true)
            } else {
                // File entry
                try fm.createDirectory(at: entryURL.deletingLastPathComponent(), withIntermediateDirectories: true)

                let compressedData = Data(bytes[dataStart..<dataStart+compressedSize])

                if compressionMethod == 0 {
                    // Stored (no compression)
                    try compressedData.write(to: entryURL)
                } else if compressionMethod == 8 {
                    // Deflate: use zlib to inflate
                    let decompressed = try zlibDecompress(compressedData, expectedSize: uncompressedSize)
                    try decompressed.write(to: entryURL)
                } else {
                    print("OTA: Skipping \(fileName), unsupported compression method \(compressionMethod)")
                }
            }

            offset = dataStart + compressedSize
        }
    }

    /// Decompress deflated data using zlib (built into iOS)
    private func zlibDecompress(_ data: Data, expectedSize: Int) throws -> Data {
        var stream = z_stream()
        stream.next_in = UnsafeMutablePointer<Bytef>(mutating: (data as NSData).bytes.assumingMemoryBound(to: Bytef.self))
        stream.avail_in = uInt(data.count)

        // Use -MAX_WBITS for raw deflate (no zlib/gzip header)
        guard inflateInit2_(&stream, -MAX_WBITS, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else {
            throw NSError(domain: "OTAUpdate", code: -1, userInfo: [NSLocalizedDescriptionKey: "inflateInit failed"])
        }

        defer { inflateEnd(&stream) }

        var result = Data(count: max(expectedSize, data.count * 2))
        return try result.withUnsafeMutableBytes { outputBuffer -> Data in
            stream.next_out = outputBuffer.baseAddress?.assumingMemoryBound(to: Bytef.self)
            stream.avail_out = uInt(outputBuffer.count)

            let status = inflate(&stream, Z_FINISH)
            guard status == Z_STREAM_END || status == Z_OK else {
                throw NSError(domain: "OTAUpdate", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "inflate failed with status \(status)"])
            }

            return Data(outputBuffer.prefix(Int(stream.total_out)))
        }
    }
}
