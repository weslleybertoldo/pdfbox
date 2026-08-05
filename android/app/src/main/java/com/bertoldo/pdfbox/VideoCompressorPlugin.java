package com.bertoldo.pdfbox;

import android.app.Activity;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.effect.Presentation;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "VideoCompressor")
public class VideoCompressorPlugin extends Plugin {

  private static final String TAG = "VideoCompressor";

  /** Abre o picker nativo de vídeo (ACTION_OPEN_DOCUMENT); o vídeo nunca trafega pelo JS. */
  @PluginMethod
  public void pickAndCompress(PluginCall call) {
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
    intent.setType("video/*");
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    startActivityForResult(call, intent, "onVideoPicked");
  }

  @ActivityCallback
  private void onVideoPicked(PluginCall call, ActivityResult result) {
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
      call.reject("cancelled");
      return;
    }
    Uri input = result.getData().getData();
    if (input == null) {
      call.reject("cancelled");
      return;
    }

    // mode: "leve" (1080p) | "media" (720p) | "forte" (480p)
    String mode = call.getString("mode", "media");
    int height = "leve".equals(mode) ? 1080 : "forte".equals(mode) ? 480 : 720;

    long inputSize = -1;
    try (AssetFileDescriptor fd = getContext().getContentResolver().openAssetFileDescriptor(input, "r")) {
      if (fd != null) inputSize = fd.getLength();
    } catch (Exception e) {
      Log.e(TAG, "falha ao ler tamanho do vídeo de entrada", e);
    }

    startCompress(call, input, height, inputSize);
  }

  private void startCompress(PluginCall call, Uri input, int height, long inputSize) {
    File outFile = new File(getContext().getCacheDir(), "compressed-" + System.currentTimeMillis() + ".mp4");
    // volatile via AtomicBoolean: garante que o poll pare assim que onCompleted/onError disparar,
    // mesmo que getProgress() ainda reporte um estado "disponível" na mesma janela de 400ms.
    AtomicBoolean polling = new AtomicBoolean(true);
    Handler handler = new Handler(Looper.getMainLooper());

    // Transformer precisa ser criado e iniciado na mesma thread/looper (aqui, a main).
    handler.post(() -> {
      try {
        EditedMediaItem item = new EditedMediaItem.Builder(MediaItem.fromUri(input))
            .setEffects(new Effects(
                Collections.emptyList(),
                Collections.singletonList(Presentation.createForHeight(height))))
            .build();

        Transformer transformer = new Transformer.Builder(getContext())
            .setVideoMimeType(MimeTypes.VIDEO_H264)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            .addListener(new Transformer.Listener() {
              @Override
              public void onCompleted(Composition composition, ExportResult exportResult) {
                polling.set(false);
                JSObject ret = new JSObject();
                ret.put("path", outFile.getAbsolutePath());
                ret.put("inputSize", inputSize);
                ret.put("outputSize", outFile.length());
                call.resolve(ret);
              }

              @Override
              public void onError(Composition composition, ExportResult exportResult, ExportException exception) {
                polling.set(false);
                Log.e(TAG, "erro na compressão de vídeo", exception);
                call.reject("Erro ao comprimir o vídeo");
              }
            })
            .build();

        transformer.start(item, outFile.getAbsolutePath());
        pollProgress(transformer, handler, polling);
      } catch (Exception e) {
        polling.set(false);
        Log.e(TAG, "falha ao iniciar a compressão", e);
        call.reject("Erro ao iniciar a compressão do vídeo");
      }
    });
  }

  private void pollProgress(Transformer transformer, Handler handler, AtomicBoolean polling) {
    ProgressHolder holder = new ProgressHolder();
    Runnable poll = new Runnable() {
      @Override
      public void run() {
        if (!polling.get()) return; // onCompleted/onError já resolveu a call — para o poll
        int state = transformer.getProgress(holder);
        if (state == Transformer.PROGRESS_STATE_AVAILABLE) {
          JSObject data = new JSObject();
          data.put("percent", holder.progress);
          notifyListeners("compressProgress", data);
        }
        if (polling.get()) handler.postDelayed(this, 400);
      }
    };
    handler.post(poll);
  }
}
