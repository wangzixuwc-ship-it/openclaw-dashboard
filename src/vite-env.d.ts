/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GATEWAY_URL: string
  readonly VITE_WS_URL: string
  readonly VITE_GATEWAY_TOKEN: string
  readonly VITE_ELECTRICITY_PER_HOUR?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
