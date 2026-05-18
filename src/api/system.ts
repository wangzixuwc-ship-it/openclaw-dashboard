import axios from 'axios'

/**
 * 获取系统版本号 (REC-066)
 * 后端接口: GET /api/system/version → 端口 31002
 * 开发环境通过 Vite proxy 转发，生产环境直连后端
 * 返回: { version: string }
 */
export async function getVersion(): Promise<{ version: string } | null> {
  try {
    const url = import.meta.env.DEV
      ? '/api/system/version'
      : `${import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:31002'}/api/system/version`
    const resp = await axios.get(url, { timeout: 10000 })
    return resp.data as { version: string }
  } catch {
    return null
  }
}

/**
 * 网关诊断修复 (REC-003)
 * 后端接口: POST /api/system/doctor → 端口 31002
 * 执行 openclaw doctor 命令，返回诊断结果
 * 返回: { success: boolean, stdout: string, stderr: string, command: string, platform: string, error?: string }
 */
export interface DoctorResult {
  success: boolean
  stdout: string
  stderr: string
  command: string
  platform: string
  error?: string
}

export async function runDoctor(): Promise<DoctorResult | null> {
  try {
    const url = import.meta.env.DEV
      ? '/api/system/doctor'
      : `${import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:31002'}/api/system/doctor`
    const resp = await axios.post(url, {}, { timeout: 120000 })
    return resp.data as DoctorResult
  } catch (e: unknown) {
    console.error('[System] runDoctor error:', e)
    return null
  }
}
