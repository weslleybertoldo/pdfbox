package com.bertoldo.pdfbox;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONException;

/**
 * Compartilhamento direcionado ("Compartilhar escolhido"):
 * - list(): apps do aparelho que aceitam receber arquivos (ACTION_SEND),
 *   com label + ícone (PNG base64 ~96px), 1 entrada por package.
 * - shareTo(): ACTION_SEND direto pra activity escolhida (sem chooser),
 *   com URI de FileProvider do arquivo no cache do app.
 * Requer o bloco <queries> do ACTION_SEND no AndroidManifest (Android 11+
 * package visibility — sem ele o queryIntentActivities volta vazio).
 */
@CapacitorPlugin(name = "ShareTargets")
public class ShareTargetsPlugin extends Plugin {

  private static final String TAG = "ShareTargets";
  private static final int ICON_PX = 96;

  @PluginMethod
  public void list(PluginCall call) {
    try {
      PackageManager pm = getContext().getPackageManager();
      Intent probe = new Intent(Intent.ACTION_SEND).setType("*/*");
      List<ResolveInfo> infos = pm.queryIntentActivities(probe, 0);
      // dedup por package: 1 entrada por app, atividade preferida = a primeira
      Map<String, ResolveInfo> byPackage = new LinkedHashMap<>();
      for (ResolveInfo info : infos) {
        if (info.activityInfo == null) continue;
        String pkg = info.activityInfo.packageName;
        if (pkg.equals(getContext().getPackageName())) continue; // não listar o próprio app
        if (!byPackage.containsKey(pkg)) byPackage.put(pkg, info);
      }
      JSArray apps = new JSArray();
      for (ResolveInfo info : byPackage.values()) {
        JSObject app = new JSObject();
        app.put("label", String.valueOf(info.loadLabel(pm)));
        app.put("packageName", info.activityInfo.packageName);
        app.put("activityName", info.activityInfo.name);
        app.put("icon", iconBase64(info.loadIcon(pm)));
        apps.put(app);
      }
      JSObject ret = new JSObject();
      ret.put("apps", apps);
      call.resolve(ret);
    } catch (Exception e) {
      Log.e(TAG, "list failed", e);
      call.reject("Erro ao listar apps de compartilhamento");
    }
  }

  /**
   * options: { packageName, activityName, paths: string[] (cache, aceita
   * prefixo file://), mimeType, fileName? }. 1 path = ACTION_SEND;
   * 2+ = ACTION_SEND_MULTIPLE (Drive/Gmail/OneDrive etc. aceitam ambos).
   */
  @PluginMethod
  public void shareTo(PluginCall call) {
    String packageName = call.getString("packageName");
    String activityName = call.getString("activityName");
    String mimeType = call.getString("mimeType", "*/*");
    String fileName = call.getString("fileName");
    JSArray pathsArr = call.getArray("paths");
    if (packageName == null || activityName == null || pathsArr == null || pathsArr.length() == 0) {
      call.reject("packageName, activityName e paths são obrigatórios");
      return;
    }
    try {
      ArrayList<Uri> uris = new ArrayList<>();
      for (int i = 0; i < pathsArr.length(); i++) {
        String path = pathsArr.getString(i);
        if (path.startsWith("file://")) path = Uri.parse(path).getPath();
        File f = new File(path);
        if (!f.exists()) {
          call.reject("Arquivo não encontrado: " + f.getName());
          return;
        }
        uris.add(FileProvider.getUriForFile(
            getContext(), getContext().getPackageName() + ".fileprovider", f));
      }
      Intent intent;
      if (uris.size() == 1) {
        intent = new Intent(Intent.ACTION_SEND);
        intent.putExtra(Intent.EXTRA_STREAM, uris.get(0));
      } else {
        intent = new Intent(Intent.ACTION_SEND_MULTIPLE);
        intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
      }
      intent.setType(mimeType);
      intent.setClassName(packageName, activityName);
      if (fileName != null) intent.putExtra(Intent.EXTRA_SUBJECT, fileName);
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      call.resolve();
    } catch (ActivityNotFoundException e) {
      // app desinstalado/atividade removida desde a última listagem
      call.reject("App não encontrado — ele pode ter sido desinstalado");
    } catch (SecurityException e) {
      Log.e(TAG, "shareTo blocked", e);
      call.reject("O app escolhido não permite receber este arquivo");
    } catch (JSONException | RuntimeException e) {
      Log.e(TAG, "shareTo failed", e);
      call.reject("Erro ao compartilhar com o app escolhido");
    }
  }

  /**
   * Drawable → Bitmap → PNG base64 (sem prefixo data:). AdaptiveIconDrawable
   * (e qualquer drawable sem bitmap) é rasterizado desenhando num canvas.
   */
  private static String iconBase64(Drawable d) {
    try {
      Bitmap bmp;
      if (d instanceof BitmapDrawable && ((BitmapDrawable) d).getBitmap() != null) {
        bmp = ((BitmapDrawable) d).getBitmap();
      } else {
        int w = Math.max(1, d.getIntrinsicWidth() > 0 ? d.getIntrinsicWidth() : ICON_PX);
        int h = Math.max(1, d.getIntrinsicHeight() > 0 ? d.getIntrinsicHeight() : ICON_PX);
        bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        d.setBounds(0, 0, w, h);
        d.draw(canvas);
      }
      if (bmp.getWidth() > ICON_PX || bmp.getHeight() > ICON_PX) {
        bmp = Bitmap.createScaledBitmap(bmp, ICON_PX, ICON_PX, true);
      }
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
      return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    } catch (Exception e) {
      Log.w(TAG, "iconBase64 failed", e);
      return ""; // sem ícone: o front mostra placeholder
    }
  }
}
