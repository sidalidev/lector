import Foundation
import UIKit
import Capacitor
import UniformTypeIdentifiers

@objc(FilePickerPlugin)
public class FilePickerPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier: String = "FilePickerPlugin"
    public let jsName: String = "FilePicker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickFolder", returnType: CAPPluginReturnPromise)
    ]

    private var pickCall: CAPPluginCall?

    /// Pick a single file using UIDocumentPickerViewController
    @objc func pickFile(_ call: CAPPluginCall) {
        self.pickCall = call

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            let supportedTypes: [UTType] = [
                .plainText,
                .pdf,
                .data,       // fallback for .md, .midi etc.
                UTType("org.daringfireball.markdown") ?? .plainText,
                UTType("public.midi-audio") ?? .data,
                UTType("com.guitar-pro.gpx") ?? .data
            ]

            let picker = UIDocumentPickerViewController(forOpeningContentTypes: supportedTypes)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            picker.shouldShowFileExtensions = true

            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    /// Pick a folder
    @objc func pickFolder(_ call: CAPPluginCall) {
        self.pickCall = call

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.delegate = self
            picker.allowsMultipleSelection = false

            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    /// Read file content from a security-scoped URL
    private func readFileContent(url: URL) -> (content: String, type: String, isBase64: Bool)? {
        guard url.startAccessingSecurityScopedResource() else {
            print("FilePicker: Cannot access security-scoped resource")
            return nil
        }
        defer { url.stopAccessingSecurityScopedResource() }

        let ext = url.pathExtension.lowercased()

        // Binary files → base64
        if ["mid", "midi", "gp", "gpx", "pdf"].contains(ext) {
            guard let data = try? Data(contentsOf: url) else { return nil }
            let base64 = data.base64EncodedString()
            let mimeType: String
            switch ext {
            case "mid", "midi": mimeType = "audio/midi"
            case "gp", "gpx": mimeType = "application/x-guitar-pro"
            case "pdf": mimeType = "application/pdf"
            default: mimeType = "application/octet-stream"
            }
            return (content: "data:\(mimeType);base64,\(base64)", type: ext == "pdf" ? "pdf" : (["mid", "midi"].contains(ext) ? "midi" : "guitarpro"), isBase64: true)
        }

        // Text files
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let type = ext == "md" ? "markdown" : "text"
        return (content: text, type: type, isBase64: false)
    }
}

extension FilePickerPlugin: UIDocumentPickerDelegate {

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first, let call = self.pickCall else {
            self.pickCall?.reject("No file selected")
            self.pickCall = nil
            return
        }

        let fileName = url.lastPathComponent

        // For folder picks, just return the path
        if url.hasDirectoryPath {
            call.resolve([
                "path": url.path,
                "name": fileName,
                "isDirectory": true
            ])
            self.pickCall = nil
            return
        }

        // Read file content
        guard let result = readFileContent(url: url) else {
            call.reject("Cannot read file")
            self.pickCall = nil
            return
        }

        // Bookmark the URL for future access
        if let bookmarkData = try? url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil) {
            UserDefaults.standard.set(bookmarkData, forKey: "filepicker-bookmark-\(fileName)")
        }

        call.resolve([
            "content": result.content,
            "fileName": fileName,
            "filePath": url.path,
            "dirPath": url.deletingLastPathComponent().path,
            "type": result.type
        ])
        self.pickCall = nil
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        self.pickCall?.resolve(["cancelled": true])
        self.pickCall = nil
    }
}
