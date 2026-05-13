import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const gatewayUrl = env.VITE_GATEWAY_URL || 'http://127.0.0.1:18789'
  const frontendPort = parseInt(process.env.FRONTEND_PORT || '31001', 10)
  const backendPort = 31002 // 统一服务端口 (合并了 GPU VRAM + Usage Stats + Reset Agent)

  console.log('[Vite] Gateway URL:', gatewayUrl)
  console.log('[Vite] Frontend Port:', frontendPort)
  console.log('[Vite] Backend Port (for proxy):', backendPort)

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
      port: frontendPort,
      cors: true, // 允许跨域访问（远程连接支持）
      proxy: {
        '/api/gpu-vram': {
          // GPU VRAM 统一服务 (端口 31002)
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
        '/api/usage': {
          // Usage Stats 统一服务 (端口 31002)
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
        '/api': {
          target: gatewayUrl,
          changeOrigin: true,
          ws: true, // Enable WebSocket proxy
          rewrite: (path) => path.replace(/^\/api/, ''),
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
