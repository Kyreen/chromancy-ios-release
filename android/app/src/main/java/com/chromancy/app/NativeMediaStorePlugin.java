package com.chromancy.app;

import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@CapacitorPlugin(name = "NativeMediaStore")
public class NativeMediaStorePlugin extends Plugin {
    private static class PendingSave {
        final Uri uri;
        final String displayName;
        final String relativePath;
        final String mimeType;
        final OutputStream outputStream;

        PendingSave(Uri uri, String displayName, String relativePath, String mimeType, OutputStream outputStream) {
            this.uri = uri;
            this.displayName = displayName;
            this.relativePath = relativePath;
            this.mimeType = mimeType;
            this.outputStream = outputStream;
        }
    }

    private final Map<String, PendingSave> pendingSaves = new HashMap<>();

    @PluginMethod
    public void saveFile(PluginCall call) {
        String base64Data = call.getString("base64Data");
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "application/octet-stream");

        if (base64Data == null || base64Data.isEmpty()) {
            call.reject("Missing file data.");
            return;
        }

        if (fileName == null || fileName.trim().isEmpty()) {
            call.reject("Missing file name.");
            return;
        }

        try {
            byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
            PendingSave pendingSave = createPendingSave(fileName.trim(), mimeType);

            try {
                pendingSave.outputStream.write(bytes);
                pendingSave.outputStream.flush();
            } catch (IOException ioError) {
                abortPendingSave(pendingSave);
                call.reject("Unable to write file.", ioError);
                return;
            }

            try {
                call.resolve(finalizePendingSave(pendingSave));
            } catch (Exception finishError) {
                abortPendingSave(pendingSave);
                call.reject("Unable to save file.", finishError);
            }
        } catch (IllegalArgumentException decodeError) {
            call.reject("Invalid file data.", decodeError);
        } catch (Exception error) {
            call.reject("Unable to save file.", error);
        }
    }

    @PluginMethod
    public void beginFile(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "application/octet-stream");

        if (fileName == null || fileName.trim().isEmpty()) {
            call.reject("Missing file name.");
            return;
        }

        try {
            PendingSave pendingSave = createPendingSave(fileName.trim(), mimeType);
            String sessionId = UUID.randomUUID().toString();
            pendingSaves.put(sessionId, pendingSave);

            JSObject result = new JSObject();
            result.put("sessionId", sessionId);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to prepare destination file.", error);
        }
    }

    @PluginMethod
    public void appendChunk(PluginCall call) {
        String sessionId = call.getString("sessionId");
        String base64Chunk = call.getString("base64Chunk");

        if (sessionId == null || sessionId.isEmpty()) {
            call.reject("Missing file save session.");
            return;
        }

        PendingSave pendingSave = pendingSaves.get(sessionId);
        if (pendingSave == null) {
            call.reject("File save session is no longer available.");
            return;
        }

        if (base64Chunk == null || base64Chunk.isEmpty()) {
            call.reject("Missing file chunk.");
            return;
        }

        try {
            byte[] bytes = Base64.decode(base64Chunk, Base64.DEFAULT);
            pendingSave.outputStream.write(bytes);
            call.resolve();
        } catch (IllegalArgumentException decodeError) {
            abortPendingSave(pendingSave);
            pendingSaves.remove(sessionId);
            call.reject("Invalid file chunk.", decodeError);
        } catch (IOException ioError) {
            abortPendingSave(pendingSave);
            pendingSaves.remove(sessionId);
            call.reject("Unable to write file chunk.", ioError);
        }
    }

    @PluginMethod
    public void finishFile(PluginCall call) {
        String sessionId = call.getString("sessionId");

        if (sessionId == null || sessionId.isEmpty()) {
            call.reject("Missing file save session.");
            return;
        }

        PendingSave pendingSave = pendingSaves.remove(sessionId);
        if (pendingSave == null) {
            call.reject("File save session is no longer available.");
            return;
        }

        try {
            call.resolve(finalizePendingSave(pendingSave));
        } catch (Exception error) {
            abortPendingSave(pendingSave);
            call.reject("Unable to finalize file save.", error);
        }
    }

    @PluginMethod
    public void abortFile(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (sessionId == null || sessionId.isEmpty()) {
            call.resolve();
            return;
        }

        PendingSave pendingSave = pendingSaves.remove(sessionId);
        if (pendingSave != null) {
            abortPendingSave(pendingSave);
        }
        call.resolve();
    }

    private PendingSave createPendingSave(String fileName, String mimeType) throws IOException {
        String safeName = ensureExtension(fileName, mimeType);
        Uri collection = resolveCollection(mimeType);
        String relativePath = resolveRelativePath(mimeType);

        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath);
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        }

        Uri uri = getContext().getContentResolver().insert(collection, values);
        if (uri == null) {
            throw new IOException("Unable to create destination file.");
        }

        OutputStream outputStream = getContext().getContentResolver().openOutputStream(uri, "w");
        if (outputStream == null) {
            getContext().getContentResolver().delete(uri, null, null);
            throw new IOException("Unable to open destination file.");
        }

        return new PendingSave(uri, safeName, relativePath, mimeType, outputStream);
    }

    private JSObject finalizePendingSave(PendingSave pendingSave) throws IOException {
        pendingSave.outputStream.flush();
        pendingSave.outputStream.close();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues completed = new ContentValues();
            completed.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContext().getContentResolver().update(pendingSave.uri, completed, null, null);
        }

        JSObject result = new JSObject();
        result.put("uri", pendingSave.uri.toString());
        result.put("displayName", pendingSave.displayName);
        result.put("relativePath", pendingSave.relativePath);
        result.put("mimeType", pendingSave.mimeType);
        return result;
    }

    private void abortPendingSave(PendingSave pendingSave) {
        try {
            pendingSave.outputStream.close();
        } catch (IOException ignored) {
        }
        getContext().getContentResolver().delete(pendingSave.uri, null, null);
    }

    private Uri resolveCollection(String mimeType) {
        if (mimeType.startsWith("image/")) {
            return MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        }
        if (mimeType.startsWith("video/")) {
            return MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
        }
        return MediaStore.Downloads.EXTERNAL_CONTENT_URI;
    }

    private String resolveRelativePath(String mimeType) {
        if (mimeType.startsWith("image/")) {
            return Environment.DIRECTORY_PICTURES + "/Chromancy";
        }
        if (mimeType.startsWith("video/")) {
            return Environment.DIRECTORY_MOVIES + "/Chromancy";
        }
        return Environment.DIRECTORY_DOWNLOADS + "/Chromancy";
    }

    private String ensureExtension(String fileName, String mimeType) {
        if (fileName.contains(".")) {
            return fileName;
        }
        String extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
        if (extension == null || extension.isEmpty()) {
            return fileName;
        }
        return fileName + "." + extension;
    }
}
