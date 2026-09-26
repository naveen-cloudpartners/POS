import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/app/',
  plugins: [
    react(),
    {
      name: 'catalyst-spa-fallback',
      closeBundle: async () => {
        const { copyFileSync, existsSync } = await import('node:fs')
        const { resolve } = await import('node:path')
        const dist = resolve(process.cwd(), 'dist')
        const index = resolve(dist, 'index.html')
        const fallback = resolve(dist, '404.html')
        if (existsSync(index)) {
          copyFileSync(index, fallback)
          console.log('[spa-fallback] 404.html created from index.html')
        }
        // Ensure Catalyst client config is in dist with SPA fallback
        const srcPkg = resolve(process.cwd(), 'client-package.json')
        const dstPkg = resolve(dist, 'client-package.json')
        if (existsSync(srcPkg)) {
          copyFileSync(srcPkg, dstPkg)
        }
      },
    },
  ],
})
