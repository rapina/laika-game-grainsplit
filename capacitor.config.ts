import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sputnikworkshop.grainsplit',
  appName: 'Grainsplit',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
