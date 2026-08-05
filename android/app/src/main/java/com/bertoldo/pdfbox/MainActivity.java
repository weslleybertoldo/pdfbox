package com.bertoldo.pdfbox;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(MediaSaverPlugin.class);
    registerPlugin(VideoCompressorPlugin.class);
    registerPlugin(ApkInstallerPlugin.class);
    registerPlugin(IntentReceiverPlugin.class);
    registerPlugin(ShareTargetsPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
