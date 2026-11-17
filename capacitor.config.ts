import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gharzetak.app',
  appName: 'غرزتك',
  webDir: 'www/browser',
  backgroundColor: '#FFF9F5',
  android: {
    // Content is never loaded over cleartext in production builds.
    allowMixedContent: false,
  },
  plugins: {
    // Only Google is bundled. Apple/Facebook/Twitter providers are switched off (not shipped in the APK/IPA).
    SocialLogin: {
      providers: { google: true, facebook: false, apple: false, twitter: false },
    },
    Keyboard: {
      resize: 'native',
      resizeOnFullScreen: true,
    },
    // Crochet reminders: a flat white status-bar icon tinted with the brand purple. Scheduling is always inexact (see the manifest).
    LocalNotifications: {
      smallIcon: 'ic_stat_gharzetak',
      iconColor: '#813db5',
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#FFF9F5',
      overlaysWebView: false,
    },
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#FFF9F5',
      showSpinner: false,
    },
  },
};

export default config;
