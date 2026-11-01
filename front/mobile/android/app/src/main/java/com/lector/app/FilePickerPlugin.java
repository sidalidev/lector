package com.lector.app;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "FilePicker")
public class FilePickerPlugin extends Plugin {

    // Mime types supportés
    private static final String[] FILE_MIME_TYPES = {
        "text/plain",
        "text/markdown",
        "text/x-markdown",
        "application/pdf",
        "audio/midi",
        "audio/x-midi",
        "application/octet-stream"  // fallback pour .md, .gp, .gpx
    };

    @PluginMethod
    public void pickFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, FILE_MIME_TYPES);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);

        startActivityForResult(call, intent, "pickFileResult");
    }

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );

        startActivityForResult(call, intent, "pickFolderResult");
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null) {
            call.reject("uri required");
            return;
        }

        try {
            Uri treeUri = Uri.parse(uriStr);
            Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
                treeUri, DocumentsContract.getTreeDocumentId(treeUri)
            );

            List<JSObject> files = listDocumentTree(treeUri, childrenUri);
            JSObject result = new JSObject();
            result.put("files", new org.json.JSONArray(files.toString()));
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to list files: " + e.getMessage());
        }
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null) {
            call.reject("uri required");
            return;
        }

        try {
            Uri uri = Uri.parse(uriStr);
            Activity activity = getActivity();
            InputStream is = activity.getContentResolver().openInputStream(uri);
            if (is == null) {
                call.reject("Cannot open file");
                return;
            }

            String fileName = getFileName(uri);
            String ext = getExtension(fileName);

            // Fichiers binaires → base64
            if ("mid".equals(ext) || "midi".equals(ext) || "gp".equals(ext) || "gpx".equals(ext) || "pdf".equals(ext)) {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] data = new byte[4096];
                int n;
                while ((n = is.read(data)) != -1) {
                    buffer.write(data, 0, n);
                }
                is.close();

                String base64 = Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP);
                String mimeType;
                String type;
                switch (ext) {
                    case "mid": case "midi": mimeType = "audio/midi"; type = "midi"; break;
                    case "gp": case "gpx": mimeType = "application/x-guitar-pro"; type = "guitarpro"; break;
                    case "pdf": mimeType = "application/pdf"; type = "pdf"; break;
                    default: mimeType = "application/octet-stream"; type = "binary"; break;
                }

                JSObject result = new JSObject();
                result.put("content", "data:" + mimeType + ";base64," + base64);
                result.put("type", type);
                result.put("isBase64", true);
                call.resolve(result);
            } else {
                // Fichiers texte
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] data = new byte[4096];
                int n;
                while ((n = is.read(data)) != -1) {
                    buffer.write(data, 0, n);
                }
                is.close();

                JSObject result = new JSObject();
                result.put("content", buffer.toString("UTF-8"));
                result.put("type", "md".equals(ext) ? "markdown" : "text");
                result.put("isBase64", false);
                call.resolve(result);
            }
        } catch (Exception e) {
            call.reject("Failed to read file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String uriStr = call.getString("uri");
        String content = call.getString("content");
        if (uriStr == null || content == null) {
            call.reject("uri and content required");
            return;
        }

        try {
            Uri uri = Uri.parse(uriStr);
            Activity activity = getActivity();
            java.io.OutputStream os = activity.getContentResolver().openOutputStream(uri, "wt");
            if (os == null) {
                call.reject("Cannot open file for writing");
                return;
            }
            os.write(content.getBytes("UTF-8"));
            os.close();

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to write file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void createFile(PluginCall call) {
        String parentUriStr = call.getString("parentUri");
        String fileName = call.getString("fileName");
        String content = call.getString("content", "");
        if (parentUriStr == null || fileName == null) {
            call.reject("parentUri and fileName required");
            return;
        }

        try {
            Uri parentUri = Uri.parse(parentUriStr);
            String parentDocId = DocumentsContract.getTreeDocumentId(parentUri);
            Uri parentDocUri = DocumentsContract.buildDocumentUriUsingTree(parentUri, parentDocId);

            String mimeType = fileName.endsWith(".md") ? "text/markdown" : "text/plain";
            Uri newUri = DocumentsContract.createDocument(
                getActivity().getContentResolver(), parentDocUri, mimeType, fileName
            );

            if (newUri == null) {
                call.reject("Failed to create file");
                return;
            }

            // Écrire le contenu si fourni
            if (content != null && !content.isEmpty()) {
                java.io.OutputStream os = getActivity().getContentResolver().openOutputStream(newUri);
                if (os != null) {
                    os.write(content.getBytes("UTF-8"));
                    os.close();
                }
            }

            JSObject result = new JSObject();
            result.put("uri", newUri.toString());
            result.put("fileName", fileName);
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to create file: " + e.getMessage());
        }
    }

    // === Activity Result Callbacks ===

    @ActivityCallback
    private void pickFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        Uri uri = result.getData().getData();
        if (uri == null) {
            call.reject("No file selected");
            return;
        }

        // Persister les permissions
        try {
            getActivity().getContentResolver().takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
            );
        } catch (Exception ignored) {}

        String fileName = getFileName(uri);
        String ext = getExtension(fileName);

        try {
            Activity activity = getActivity();
            InputStream is = activity.getContentResolver().openInputStream(uri);
            if (is == null) {
                call.reject("Cannot read file");
                return;
            }

            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] data = new byte[4096];
            int n;
            while ((n = is.read(data)) != -1) {
                buffer.write(data, 0, n);
            }
            is.close();

            JSObject res = new JSObject();
            res.put("fileName", fileName);
            res.put("filePath", uri.toString());
            res.put("dirPath", "");

            // Fichiers binaires → base64
            if ("mid".equals(ext) || "midi".equals(ext) || "gp".equals(ext) || "gpx".equals(ext) || "pdf".equals(ext)) {
                String base64 = Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP);
                String mimeType;
                String type;
                switch (ext) {
                    case "mid": case "midi": mimeType = "audio/midi"; type = "midi"; break;
                    case "gp": case "gpx": mimeType = "application/x-guitar-pro"; type = "guitarpro"; break;
                    case "pdf": mimeType = "application/pdf"; type = "pdf"; break;
                    default: mimeType = "application/octet-stream"; type = "binary"; break;
                }
                res.put("content", "data:" + mimeType + ";base64," + base64);
                res.put("type", type);
            } else {
                res.put("content", buffer.toString("UTF-8"));
                res.put("type", "md".equals(ext) ? "markdown" : "text");
            }

            call.resolve(res);
        } catch (Exception e) {
            call.reject("Failed to read file: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void pickFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        Uri treeUri = result.getData().getData();
        if (treeUri == null) {
            call.reject("No folder selected");
            return;
        }

        // Persister les permissions lecture + écriture
        try {
            getActivity().getContentResolver().takePersistableUriPermission(
                treeUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        } catch (Exception ignored) {}

        // Récupérer le nom du dossier
        String docId = DocumentsContract.getTreeDocumentId(treeUri);
        String folderName = docId.contains(":") ? docId.substring(docId.lastIndexOf(":") + 1) : docId;
        if (folderName.contains("/")) {
            folderName = folderName.substring(folderName.lastIndexOf("/") + 1);
        }

        JSObject res = new JSObject();
        res.put("path", treeUri.toString());
        res.put("name", folderName);
        res.put("isDirectory", true);
        call.resolve(res);
    }

    // === Helpers ===

    private List<JSObject> listDocumentTree(Uri treeUri, Uri childrenUri) {
        List<JSObject> files = new ArrayList<>();
        Activity activity = getActivity();

        Cursor cursor = activity.getContentResolver().query(
            childrenUri,
            new String[]{
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE
            },
            null, null, null
        );

        if (cursor == null) return files;

        while (cursor.moveToNext()) {
            String docId = cursor.getString(0);
            String name = cursor.getString(1);
            String mimeType = cursor.getString(2);
            boolean isDir = DocumentsContract.Document.MIME_TYPE_DIR.equals(mimeType);

            Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);

            JSObject file = new JSObject();
            file.put("name", name);
            file.put("path", docUri.toString());
            file.put("isDirectory", isDir);

            if (isDir) {
                Uri subChildrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);
                try {
                    List<JSObject> children = listDocumentTree(treeUri, subChildrenUri);
                    file.put("children", new org.json.JSONArray(children.toString()));
                } catch (Exception ignored) {
                    file.put("children", new org.json.JSONArray());
                }
            }

            files.add(file);
        }

        cursor.close();
        return files;
    }

    private String getFileName(Uri uri) {
        String name = null;
        try {
            Cursor cursor = getActivity().getContentResolver().query(uri, null, null, null, null);
            if (cursor != null) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (cursor.moveToFirst() && nameIndex >= 0) {
                    name = cursor.getString(nameIndex);
                }
                cursor.close();
            }
        } catch (Exception ignored) {}

        if (name == null) {
            name = uri.getLastPathSegment();
        }
        return name != null ? name : "unknown";
    }

    private String getExtension(String fileName) {
        if (fileName == null) return "";
        int dot = fileName.lastIndexOf('.');
        return dot >= 0 ? fileName.substring(dot + 1).toLowerCase() : "";
    }
}
