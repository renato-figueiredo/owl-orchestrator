import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser only talks to the Vite origin; `/api/*` is proxied to the OWL server. Host and Origin stay on
// loopback, so the server's DNS-rebinding/CSRF guard keeps working with no CORS exceptions.
const apiTarget = `http://127.0.0.1:${process.env.OWL_PORT ?? '4317'}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.OWL_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: { '/api': { target: apiTarget, rewrite: (path) => path.replace(/^\/api/, '') } },
  },
});
