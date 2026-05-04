/**
 * Authentication configuration
 * Manages gateway auth token storage and retrieval
 */

const STORAGE_KEY = 'gateway-token'
const GATEWAY_TOKEN = import.meta.env.VITE_GATEWAY_TOKEN

/**
 * Get auth token — 优先使用环境变量中的 token
 */
export function getAuthToken(): string | null {
  if (GATEWAY_TOKEN) return GATEWAY_TOKEN
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    // localStorage may not be available in some environments
    return null
  }
}

/**
 * Set auth token in localStorage
 */
export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token)
  } catch (e) {
    console.warn('[Auth] Failed to save token:', e)
  }
}

/**
 * Clear auth token from localStorage
 */
export function clearAuthToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
