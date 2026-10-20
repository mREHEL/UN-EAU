import { existsSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [developmentEntry(), vue(), tailwindcss()],
  base: process.env.GITHUB_ACTIONS
    ? `/${process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'UN-EAU'}/`
    : '/',
  build: {
    rollupOptions: {
      input: resolve(import.meta.dirname, 'index.dev.html'),
    },
  },
})

/** Keeps the repository root publishable while Vite uses the source HTML in development. */
function developmentEntry(): Plugin {
  return {
    name: 'uneau-development-entry',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url === '/' || request.url?.startsWith('/?')) {
          request.url = `/index.dev.html${request.url.slice(1)}`
        }
        next()
      })
    },
    closeBundle() {
      const source = resolve(import.meta.dirname, 'dist/index.dev.html')
      const target = resolve(import.meta.dirname, 'dist/index.html')
      if (existsSync(source)) renameSync(source, target)
    },
  }
}
