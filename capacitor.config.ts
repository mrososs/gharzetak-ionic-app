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
    Keyboard: {
      resize: 'native',
      resizeOnFullScreen: true,
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
