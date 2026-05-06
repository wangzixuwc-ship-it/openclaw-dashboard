import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const gatewayUrl = env.VITE_GATEWAY_URL || 'http://127.0.0.1:18789'
  
  console.log('[Vite] Gateway URL:', gatewayUrl)
  
  return {
    plugins: [
      vue(),
      AutoImport({
        resolvers: [ElementPlusResolver()],
      }),
      Components({
        resolvers: [ElementPlusResolver()],
      }),
    ],
    server: {
      host: '0.0.0.0',
      port: 3000,
      proxy: {
        '/api': {
          target: gatewayUrl,
          changeOrigin: true,
          ws: true, // Enable WebSocket proxy
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        '/usage-stats': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/usage-stats/, ''),
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules')) {
              if (id.includes('element-plus')) return 'element-plus'
              if (id.includes('vue') || id.includes('pinia')) return 'vendor'
              return 'async-vendor'
            }
          },
        },
      },
    },
  }
})
