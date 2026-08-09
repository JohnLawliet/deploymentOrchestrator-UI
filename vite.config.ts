import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'node:url'

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = parseInt(env.VITE_FRONTEND_PORT || '3000')
  const basePath = env.VITE_BASE_PATH || '/deploymentOrchestrator'
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://localhost:8080'

  return {
    base: basePath,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(sourceDirectory, './src'),
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      clearMocks: true,
    },
    server: {
      port,
      proxy: {
        [`${basePath}/api`]: {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
