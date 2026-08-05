import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.bertoldo.pdfbox",
  appName: "PDFBox",
  webDir: "dist",
  android: { webContentsDebuggingEnabled: false },
  server: { androidScheme: "https" },
};

export default config;
