import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev server mirrors the production nginx reverse-proxy: it forwards REST calls
// to Bitunix / Binance so the browser never hits a CORS wall. WebSockets are
// CORS-exempt and connect directly from the browser, so they are not proxied.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/bitunix': {
        target: 'https://fapi.bitunix.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/bitunix/, ''),
      },
      '/binance': {
        target: 'https://fapi.binance.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/binance/, ''),
      },
    },
  },
})
