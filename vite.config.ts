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
                // El despliegue sirve por HTTPS, así que marca la cookie de
                // sesión como Secure. Aquí se llega por http://localhost y hay
                // navegadores que entonces la tiran sin decir nada: se entra,
                // el servidor responde que todo bien, y la siguiente petición
                // vuelve a ser anónima. Se quita la marca sólo en este proxy,
                // que existe únicamente para desarrollo.
                configure: (proxy) => {
                  proxy.on('proxyRes', (proxyRes) => {
                    const set = proxyRes.headers['set-cookie'];
                    if (set) {
                      proxyRes.headers['set-cookie'] = set.map((cookie) =>
                        cookie.replace(/;\s*Secure/gi, ''),
                      );
                    }
                  });
                },
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
