import Foundation
import Capacitor

@objc(ICloudPlugin)
public class ICloudPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier: String = "ICloudPlugin"
    public let jsName: String = "ICloud"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getContainerURL", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFileBase64", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createFolder", returnType: CAPPluginReturnPromise)
    ]

    private let containerID = "iCloud.com.lector.app"

    private var iCloudContainerURL: URL? {
        guard let baseURL = FileManager.default.url(forUbiquityContainerIdentifier: containerID) else {
            return nil
        }
        return baseURL.appendingPathComponent("Documents")
    }

    public override func load() {
        print("🔌 ICloudPlugin loaded!")
    }

    @objc public func isAvailable(_ call: CAPPluginCall) {
        let url = FileManager.default.url(forUbiquityContainerIdentifier: containerID)
        let available = url != nil

        print("🔍 iCloud check - url: \(url?.path ?? "nil"), available: \(available)")
        call.resolve(["available": available])
    }

    @objc public func getContainerURL(_ call: CAPPluginCall) {
        guard let url = iCloudContainerURL else {
            call.reject("iCloud not available")
            return
        }

        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        call.resolve(["url": url.path])
    }

    @objc public func listFiles(_ call: CAPPluginCall) {
        let path = call.getString("path") ?? ""

        guard let baseURL = iCloudContainerURL else {
            call.reject("iCloud not available")
            return
        }

        let targetURL = path.isEmpty ? baseURL : baseURL.appendingPathComponent(path)
        let fm = FileManager.default

        // Create directory if needed
        if !fm.fileExists(atPath: targetURL.path) {
            try? fm.createDirectory(at: targetURL, withIntermediateDirectories: true)
        }

        do {
            let contents = try fm.contentsOfDirectory(
                at: targetURL,
                includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey, .fileSizeKey],
                options: .skipsHiddenFiles
            )

            let dateFormatter = ISO8601DateFormatter()

            var files: [[String: Any]] = contents.map { url in
                let isDirectory = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                let modDate = try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
                let fileSize = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0

                let relativePath = url.path.replacingOccurrences(of: baseURL.path + "/", with: "")

                return [
                    "name": url.lastPathComponent,
                    "path": relativePath,
                    "isDirectory": isDirectory,
                    "modifiedAt": modDate.map { dateFormatter.string(from: $0) } ?? "",
                    "size": fileSize
                ]
            }

            // Sort: folders first, then alphabetically
            files.sort { a, b in
                let aDir = a["isDirectory"] as? Bool ?? false
                let bDir = b["isDirectory"] as? Bool ?? false
                if aDir != bDir { return aDir }
                return (a["name"] as? String ?? "") < (b["name"] as? String ?? "")
            }

            call.resolve(["files": files])
        } catch {
            call.reject("Failed to list files: \(error.localizedDescription)")
        }
    }

    @objc public func readFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Path required")
            return
        }

        guard let baseURL = iCloudContainerURL else {
            call.reject("iCloud not available")
            return
        }

        let fileURL = baseURL.appendingPathComponent(path)

        // Start downloading if needed
        try? FileManager.default.startDownloadingUbiquitousItem(at: fileURL)

        do {
            let content = try String(contentsOf: fileURL, encoding: .utf8)
            call.resolve(["content": content])
        } catch {
            call.reject("Failed to read file: \(error.localizedDescription)")
        }
    }

    @objc public func readFileBase64(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Path required")
            return
        }

        guard let baseURL = iCloudContainerURL else {
            call.reject("iCloud not available")
            return
        }

        let fileURL = baseURL.appendingPathComponent(path)
        let fm = FileManager.default

        // Trigger iCloud download if the file is not local
        try? fm.startDownloadingUbiquitousItem(at: fileURL)

        // Wait for download with polling (max 15s)
        DispatchQueue.global(qos: .userInitiated).async {
            let maxWait = 15.0
            let interval = 0.3
            var waited = 0.0

            while waited < maxWait {
                // Check if file exists and is not a placeholder (.icloud file)
                let fileName = fileURL.lastPathComponent
                let placeholderName = ".\(fileName).icloud"
                let placeholderURL = fileURL.deletingLastPathComponent().appendingPathComponent(placeholderName)

                if fm.fileExists(atPath: fileURL.path) && !fm.fileExists(atPath: placeholderURL.path) {
                    break
                }
                Thread.sleep(forTimeInterval: interval)
                waited += interval
            }

            // Read file as binary data
            guard let data = fm.contents(atPath: fileURL.path) else {
                call.reject("Failed to read file or download timed out")
                return
            }

            let base64 = data.base64EncodedString()
            let ext = fileURL.pathExtension.lowercased()

            let mimeType: String
            switch ext {
            case "png": mimeType = "image/png"
            case "jpg", "jpeg": mimeType = "image/jpeg"
            case "gif": mimeType = "image/gif"
            case "webp": mimeType = "image/webp"
            case "svg": mimeType = "image/svg+xml"
            case "mp4": mimeType = "video/mp4"
            case "mov": mimeType = "video/quicktime"
            case "webm": mimeType = "video/webm"
            case "mid", "midi": mimeType = "audio/midi"
            default: mimeType = "application/octet-stream"
            }

            call.resolve([
                "data": "data:\(mimeType);base64,\(base64)",
                "mimeType": mimeType,
                "size": data.count
            ])
        }
    }

    @objc public func writeFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path"),
              let content = call.getString("content") else {
            call.reject("Path and content required")
            return
        }

        guard let baseURL = iCloudContainerURL else {
            call.reject("iCloud not available")
            return
        }

        let fileURL = baseURL.appendingPathComponent(path)
        let parentURL = fileURL.deletingLastPathComponent()

        try? FileManager.default.createDirectory(at: parentURL, withIntermediateDirectories: true)

        do {
            try content.write(to: fileURL, atomically: true, encoding: .utf8)
            call.resolve(["success": true])
        } catch {
            call.reject("Failed to write file: \(error.localizedDescription)")
        }
    }

    @objc public func deleteFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Path required")
            return
        }

        guard let baseURL = iCloudContainerURL else {
            call.reject("iCloud not available")
            return
        }

        let fileURL = baseURL.appendingPathComponent(path)

        do {
            try FileManager.default.removeItem(at: fileURL)
            call.resolve(["success": true])
        } catch {
            call.reject("Failed to delete file: \(error.localizedDescription)")
        }
    }

    @objc public func createFolder(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Path required")
            return
        }

        guard let baseURL = iCloudContainerURL else {
            call.reject("iCloud not available")
            return
        }

        let folderURL = baseURL.appendingPathComponent(path)

        do {
            try FileManager.default.createDirectory(at: folderURL, withIntermediateDirectories: true)
            call.resolve(["success": true])
        } catch {
            call.reject("Failed to create folder: \(error.localizedDescription)")
        }
    }
}
