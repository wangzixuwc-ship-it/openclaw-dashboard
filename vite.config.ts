import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// 读取 package.json 版本号
const pkg = JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf-8'))

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
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
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
        '/api/agents-configured': {
          // 已配置 agent 列表 (端口 31002, 修复升级后新 agent 不显示问题)
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
        '/api/agent-running-status': {
          // Agent 运行状态检测（基于 session 文件 mtime，端口 31002）
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
        '/api/agent-crons': {
          // 获取 Agent 定时任务列表（端口 31002）
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
        '/api/agent-live-activity': {
          // 读取 Agent 实时活动（session jsonl 末尾，端口 31002）
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
        '/api/upload-image': {
          // 图片上传 API (端口 31002, REC-093)
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
        '/uploads': {
          // 上传图片静态文件 (端口 31002, REC-093)
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
        '/api/system': {
          // 系统版本 API (端口 31002, REC-066)
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
        '/reset': {
          // 重置 Agent API (端口 31002, REC-005)
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
