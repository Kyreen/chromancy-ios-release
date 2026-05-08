import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chromancy.app',
  appName: 'Chromancy',
  webDir: 'dist',
  plugins: {
    SocialLogin: {
      providers: {
        google: false,
        apple: false,
        facebook: false,
        twitter: false,
      },
    },
  },
};

export default config;
