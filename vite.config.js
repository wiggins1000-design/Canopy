import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      // Registration is done manually in main.jsx, gated on !isNativePlatform() —
      // the native Capacitor app runs on the https://localhost origin, where
      // registering a service worker fails outright (see Sentry: "Failed to
      // register a ServiceWorker for scope ('https://localhost/')") and serves no
      // purpose anyway, since native push goes through Capacitor's own plugin,
      // not the web Push API.
      injectRegister: null,
      manifest: {
        name: 'Canopy',
        short_name: 'Canopy',
        description: 'Share what matters.',
        theme_color: '#1b4332',
        background_color: '#f4fbf4',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
      rollupOptions: {
        output: {
          minify: false,
        },
      },
    }),
  ],
})
