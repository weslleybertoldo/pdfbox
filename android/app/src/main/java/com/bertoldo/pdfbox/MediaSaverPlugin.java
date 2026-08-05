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
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
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
    if (needsStoragePermission()) {
      requestPermissionForAlias("storage", call, "storagePermCallback");
      return;
    }
    doSave(call);
  }

  /**
   * Mesmo destino do save(), mas lendo de um arquivo no disco (ex.: cache do
   * VideoCompressor) via streaming, sem carregar o conteúdo inteiro na memória.
   * collection: "downloads" | "images" | "video"
   */
  @PluginMethod
  public void saveFromPath(PluginCall call) {
    String path = call.getString("path");
    String fileName = call.getString("fileName");
    String mimeType = call.getString("mimeType");
    if (path == null || fileName == null || mimeType == null) {
      call.reject("path, fileName e mimeType são obrigatórios");
      return;
    }
    if (needsStoragePermission()) {
      requestPermissionForAlias("storage", call, "storagePermCallback");
      return;
    }
    doSaveFromPath(call);
  }

  private boolean needsStoragePermission() {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
        && getPermissionState("storage") != PermissionState.GRANTED;
  }

  @PermissionCallback
  private void storagePermCallback(PluginCall call) {
    if (getPermissionState("storage") != PermissionState.GRANTED) {
      call.reject("permissão de armazenamento negada");
      return;
    }
    if ("saveFromPath".equals(call.getMethodName())) {
      doSaveFromPath(call);
    } else {
      doSave(call);
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

  private void doSaveFromPath(PluginCall call) {
    String path = call.getString("path");
    String fileName = call.getString("fileName");
    String mimeType = call.getString("mimeType");
    String collection = call.getString("collection", "downloads");
    File src = new File(path);
    if (!src.exists()) {
      call.reject("arquivo de origem não encontrado");
      return;
    }
    try {
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
        try (InputStream is = new FileInputStream(src); OutputStream os = cr.openOutputStream(uri)) {
          copyStream(is, os);
        }
        uriStr = uri.toString();
      } else {
        String dirType = "images".equals(collection) ? Environment.DIRECTORY_PICTURES
          : "video".equals(collection) ? Environment.DIRECTORY_MOVIES
          : Environment.DIRECTORY_DOWNLOADS;
        File dir = Environment.getExternalStoragePublicDirectory(dirType);
        if (!dir.exists()) dir.mkdirs();
        File dest = new File(dir, fileName);
        try (InputStream is = new FileInputStream(src); OutputStream os = new FileOutputStream(dest)) {
          copyStream(is, os);
        }
        uriStr = Uri.fromFile(dest).toString();
      }
      JSObject ret = new JSObject();
      ret.put("uri", uriStr);
      call.resolve(ret);
    } catch (Exception e) {
      Log.e(TAG, "saveFromPath failed", e);
      call.reject("Erro ao salvar arquivo");
    }
  }

  /** Copia em blocos de 8KB, sem carregar o arquivo inteiro na memória. */
  private static void copyStream(InputStream in, OutputStream out) throws IOException {
    byte[] buffer = new byte[8192];
    int read;
    while ((read = in.read(buffer)) != -1) {
      out.write(buffer, 0, read);
    }
  }
}
