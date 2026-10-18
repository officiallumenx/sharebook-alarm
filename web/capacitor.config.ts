import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.smartvoice.alarm",
  appName: "Sharebook",
  webDir: "out",
  server: {
    androidScheme: "https",
    // Cleartext off — packaged assets load from https://localhost
    allowNavigation: [],
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#0A1628",
    // Better WebView performance for audio / canvas
    webContentsDebuggingEnabled: process.env.NODE_ENV !== "production",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 400,
      backgroundColor: "#0A1628",
      showSpinner: false,
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0A1628",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
    LocalNotifications: {
      smallIcon: "ic_stat_icon_default",
      iconColor: "#2F80ED",
      sound: "beep.wav",
    },
  },
};

export default config;
