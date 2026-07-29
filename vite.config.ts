import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // Point API_PROXY at a running deployment to work on the interface
        // against real data without standing up the API locally. Unset, the
        // dev server serves only the front end, as before.
        proxy: env.API_PROXY
          ? {
              '/api': {
                target: env.API_PROXY,
                changeOrigin: true,
                cookieDomainRewrite: '',
              },
            }
          : undefined,
      },
      base: process.env.BASE_PATH || env.BASE_PATH || '/Where-Winds-Meet-Guild-Manager/',
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
