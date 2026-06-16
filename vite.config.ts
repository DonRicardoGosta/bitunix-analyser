import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Static headers the Bitunix web app sends to its internal api.bitunix.com host.
// They are not per-user and must accompany requests to that endpoint.
const BITUNIX_WEB_HEADERS: Record<string, string> = {
  origin: 'https://www.bitunix.com',
  referer: 'https://www.bitunix.com/',
  'client-type': 'pc',
  clienttype: 'pc',
  'exchange-client': 'pc',
  'platform-cu': 'pc',
  'build-cu': '200000011',
  language: 'en_US',
  'exchange-language': 'en_US',
  'accept-language': 'en_US',
}

// Dev server mirrors the production nginx reverse-proxy: it forwards REST calls
// to Bitunix / Binance so the browser never hits a CORS wall. WebSockets are
// CORS-exempt and connect directly from the browser, so they are not proxied.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Internal Bitunix web API (trigger/stop orders), authenticated by a web
      // session token rather than the API key. Must be matched before /bitunix.
      '/bitunix-web': {
        target: 'https://api.bitunix.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/bitunix-web/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            for (const [k, v] of Object.entries(BITUNIX_WEB_HEADERS)) {
              proxyReq.setHeader(k, v)
            }
          })
        },
      },
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
