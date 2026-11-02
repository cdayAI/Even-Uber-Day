import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Port 3000 belongs to the Express API server (server.ts) — that address is
    // baked into the iOS companion app. The Vite dev server has to live
    // somewhere else or `npm run dev` starts two processes fighting over the
    // same port. App.tsx calls the API same-origin and Vite forwards it, so the
    // page also works when loaded from another device (`npm run dev:glasses`).
    port: 5173,
    host: '127.0.0.1',
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/health': 'http://127.0.0.1:3000',
    },
  },
  build: {
    // Vite 4's default target, kept explicitly: Vite 7 raised its default to
    // Safari 16, and the bundle runs in the Even App's WebView on whatever iOS
    // the phone has. This is the output the hardware test was run against.
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
  },
})
