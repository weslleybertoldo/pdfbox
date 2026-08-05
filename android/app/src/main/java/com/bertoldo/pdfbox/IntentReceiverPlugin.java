package com.bertoldo.pdfbox;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Recebe intents ACTION_VIEW ("Abrir com → PDFBox") e ACTION_SEND
 * ("Compartilhar → PDFBox") de outros apps e entrega o arquivo ao WebView:
 * copia o content:// pro cacheDir e o JS lê o cache via Filesystem
 * (Directory.Cache) — ver src/lib/intentReceiver.ts.
 *
 * Cold start: o JS chama getPendingFile() no mount e lemos o intent de launch
 * da Activity. App já aberto: handleOnNewIntent guarda o intent e emite o
 * evento "fileOpened" pro JS buscar. Cada intent é entregue UMA única vez.
 */
@CapacitorPlugin(name = "IntentReceiver")
public class IntentReceiverPlugin extends Plugin {

  private static final String TAG = "IntentReceiver";

  private Intent pendingIntent;       // VIEW/SEND chegado com o app já aberto (onNewIntent)
  private boolean coldIntentConsumed; // intent de launch já foi entregue ao JS

  @Override
  protected void handleOnNewIntent(Intent intent) {
    super.handleOnNewIntent(intent);
    if (fileUriFrom(intent) != null) {
      pendingIntent = intent;
      // retained: se o JS ainda não registrou o listener, entrega ao registrar
      notifyListeners("fileOpened", new JSObject(), true);
    }
  }

  /**
   * Se há um VIEW/SEND pendente, copia o arquivo pro cache (streaming 8KB) e
   * resolve { path, name, mimeType }; senão resolve {} vazio.
   */
  @PluginMethod
  public void getPendingFile(PluginCall call) {
    Intent intent = pendingIntent;
    pendingIntent = null; // não re-entregar
    if (intent == null && !coldIntentConsumed) {
      coldIntentConsumed = true;
      Intent launch = getActivity().getIntent();
      if (fileUriFrom(launch) != null) intent = launch;
    }
    if (intent == null) {
      call.resolve(new JSObject());
      return;
    }
    Uri uri = fileUriFrom(intent);
    String mime = intent.getType();
    if (mime == null) mime = getContext().getContentResolver().getType(uri);
    if (mime == null) mime = "application/octet-stream";
    try {
      File out = new File(
        getContext().getCacheDir(),
        "opened-" + System.currentTimeMillis() + "." + extFor(mime)
      );
      copyUriToFile(uri, out);
      String name = displayName(uri);
      JSObject ret = new JSObject();
      ret.put("path", out.getAbsolutePath());
      ret.put("name", name != null ? name : out.getName());
      ret.put("mimeType", mime);
      call.resolve(ret);
    } catch (Exception e) {
      Log.e(TAG, "getPendingFile failed", e);
      call.reject("Erro ao ler o arquivo aberto");
    }
  }

  /**
   * URI do arquivo entregável do intent, ou null se não houver:
   * ACTION_VIEW → getData(); ACTION_SEND → EXTRA_STREAM (tipado no API 33+,
   * fallback deprecated abaixo).
   */
  private static Uri fileUriFrom(Intent intent) {
    if (intent == null) return null;
    String action = intent.getAction();
    if (Intent.ACTION_VIEW.equals(action)) return intent.getData();
    if (Intent.ACTION_SEND.equals(action)) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
      }
      @SuppressWarnings("deprecation")
      Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
      return uri;
    }
    return null;
  }

  private static String extFor(String mime) {
    switch (mime) {
      case "application/pdf": return "pdf";
      case "image/png": return "png";
      case "image/jpeg": return "jpg";
      case "image/webp": return "webp";
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return "docx";
      default: return "bin";
    }
  }

  /** DISPLAY_NAME via ContentResolver (nome real do arquivo); null se não der. */
  private String displayName(Uri uri) {
    try (Cursor c = getContext().getContentResolver().query(
        uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
      if (c != null && c.moveToFirst()) {
        int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
        if (idx >= 0) return c.getString(idx);
      }
    } catch (Exception e) {
      Log.w(TAG, "displayName query failed", e);
    }
    return null;
  }

  /** Copia em blocos de 8KB, sem carregar o arquivo inteiro na memória. */
  private void copyUriToFile(Uri uri, File out) throws IOException {
    ContentResolver cr = getContext().getContentResolver();
    try (InputStream is = cr.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
      if (is == null) throw new IOException("openInputStream retornou null");
      byte[] buffer = new byte[8192];
      int read;
      while ((read = is.read(buffer)) != -1) {
        os.write(buffer, 0, read);
      }
    }
  }
}
