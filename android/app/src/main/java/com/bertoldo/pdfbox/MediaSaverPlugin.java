package com.bertoldo.pdfbox;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

@CapacitorPlugin(
  name = "MediaSaver",
  permissions = @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage")
)
public class MediaSaverPlugin extends Plugin {

  private static final String TAG = "MediaSaver";

  /** collection: "downloads" | "images" | "video" */
  @PluginMethod
  public void save(PluginCall call) {
    String data = call.getString("data");           // base64 sem prefixo
    String fileName = call.getString("fileName");
    String mimeType = call.getString("mimeType");
    if (data == null || fileName == null || mimeType == null) {
      call.reject("data, fileName e mimeType são obrigatórios");
      return;
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
        && getPermissionState("storage") != PermissionState.GRANTED) {
      requestPermissionForAlias("storage", call, "storagePermCallback");
      return;
    }
    doSave(call);
  }

  @PermissionCallback
  private void storagePermCallback(PluginCall call) {
    if (getPermissionState("storage") == PermissionState.GRANTED) {
      doSave(call);
    } else {
      call.reject("permissão de armazenamento negada");
    }
  }

  private void doSave(PluginCall call) {
    String data = call.getString("data");           // base64 sem prefixo
    String fileName = call.getString("fileName");
    String mimeType = call.getString("mimeType");
    String collection = call.getString("collection", "downloads");
    try {
      byte[] bytes = Base64.decode(data, Base64.DEFAULT);
      String uriStr;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        Uri base;
        if ("images".equals(collection)) base = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        else if ("video".equals(collection)) base = MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
        else base = MediaStore.Downloads.EXTERNAL_CONTENT_URI;

        ContentValues cv = new ContentValues();
        cv.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
        cv.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        ContentResolver cr = getContext().getContentResolver();
        Uri uri = cr.insert(base, cv);
        if (uri == null) { call.reject("MediaStore insert falhou"); return; }
        try (OutputStream os = cr.openOutputStream(uri)) { os.write(bytes); }
        uriStr = uri.toString();
      } else {
        String dirType = "images".equals(collection) ? Environment.DIRECTORY_PICTURES
          : "video".equals(collection) ? Environment.DIRECTORY_MOVIES
          : Environment.DIRECTORY_DOWNLOADS;
        File dir = Environment.getExternalStoragePublicDirectory(dirType);
        if (!dir.exists()) dir.mkdirs();
        File f = new File(dir, fileName);
        try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
        uriStr = Uri.fromFile(f).toString();
      }
      JSObject ret = new JSObject();
      ret.put("uri", uriStr);
      call.resolve(ret);
    } catch (Exception e) {
      Log.e(TAG, "save failed", e);
      call.reject("Erro ao salvar arquivo");
    }
  }
}
