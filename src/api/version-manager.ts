import axios from 'axios'

const BACKEND_URL = import.meta.env.DEV
  ? ''
  : import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:31002'

export interface VersionInfo {
  version: string
  name: string
  description: string
  publishedAt: string
  htmlUrl: string
}

export async function getVersions(page = 1, pageSize = 10) {
  const resp = await axios.get(`${BACKEND_URL}/api/system/versions`, {
    timeout: 65000,
    params: { page, pageSize }
  })
  return resp.data as {
    versions: VersionInfo[]
    lastSync: string | null
    page?: number
    pageSize?: number
    total?: number
  }
}

export async function syncVersions() {
  const resp = await axios.post(`${BACKEND_URL}/api/system/sync-versions`, null, { timeout: 65000 })
  return resp.data as { success: boolean; count: number; source: string }
}

export async function switchVersion(version: string) {
  const resp = await axios.post(
    `${BACKEND_URL}/api/system/switch-version`,
    { version },
    { timeout: 120000 }
  )
  return resp.data as { success: boolean; message?: string; error?: string }
}

export async function getCurrentVersion() {
  const resp = await axios.get(`${BACKEND_URL}/api/system/version`, { timeout: 10000 })
  return resp.data as { version: string }
}
