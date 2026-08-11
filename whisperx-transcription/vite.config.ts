import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // In production Caddy serves the SPA and proxies /api on the same origin.
    // This keeps `npm run dev` same-origin too, so the backend needs no CORS.
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
