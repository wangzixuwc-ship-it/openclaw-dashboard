import { getAuthToken } from '../config/auth'

// Use /api/ws proxy in dev mode to avoid CORS; use direct WS URL otherwise
const rawWsUrl = import.meta.env.VITE_WS_URL
const rawGatewayUrl = import.meta.env.VITE_GATEWAY_URL
const isLocalTarget = rawWsUrl
  ? rawWsUrl.includes('localhost') || rawWsUrl.includes('127.0.0.1')
  : (rawGatewayUrl && (rawGatewayUrl.includes('localhost') || rawGatewayUrl.includes('127.0.0.1')))
const WS_BASE_URL = isLocalTarget ? '/api' : (rawWsUrl || 'ws://127.0.0.1:18789')

/**
 * Build WebSocket URL with optional auth token
 */
function buildWsUrl(): string {
  const baseUrl = `${WS_BASE_URL}/ws`
  const token = getAuthToken()
  if (token) {
    return `${baseUrl}?token=${encodeURIComponent(token)}`
  }
  console.warn('[GatewayWS] No auth token — connecting without authentication')
  return baseUrl
}

type MessageHandler = (event: Record<string, unknown>) => void
type ErrorHandler = (error: Event | Error) => void
type ReconnectHandler = (attempt: number, maxRetries: number) => void

interface WsOptions {
  heartbeatInterval?: number
  maxRetries?: number
  reconnectDelay?: number
  reconnectBackoff?: number
}

interface WsConnection {
  connect: () => void
  disconnect: () => void
  send: (data: string | Record<string, unknown>) => void
  onMessage: (handler: MessageHandler) => void
  onError: (handler: ErrorHandler) => void
  onReconnect: (handler: ReconnectHandler) => void
  onOpen: (handler: () => void) => void
  onClose: (handler: () => void) => void
  status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting'
}

const defaultOptions: Required<WsOptions> = {
  heartbeatInterval: 30000,
  maxRetries: 10,
  reconnectDelay: 3000,
  reconnectBackoff: 1.5,
}

class GatewayWebSocket {
  private ws: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  private handlers: {
    message: MessageHandler[]
    error: ErrorHandler[]
    reconnect: ReconnectHandler[]
    open: (() => void)[]
    close: (() => void)[]
  } = {
    message: [],
    error: [],
    reconnect: [],
    open: [],
    close: [],
  }
  private status: WsConnection['status'] = 'disconnected'
  private options: Required<WsOptions>
  private manualDisconnect = false

  constructor(options: Partial<WsOptions> = {}) {
    this.options = { ...defaultOptions, ...options }
  }

  get is() {
    return this.status
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    this.status = 'connecting'
    this.manualDisconnect = false

    try {
      this.ws = new WebSocket(buildWsUrl())

      this.ws.onopen = () => {
        this.status = 'connected'
        this.retryCount = 0
        this.startHeartbeat()
        this.handlers.open.forEach((h) => h())
      }

      this.ws.onmessage = (event: MessageEvent) => {
        let data: Record<string, unknown>
        try {
          data = JSON.parse(event.data)
        } catch {
          data = { raw: event.data }
        }

        // Heartbeat response — keep connection alive, don't propagate
        if (data?.type === 'heartbeat' || data?.type === 'ping') {
          return
        }

        this.handlers.message.forEach((h) => h(data))
      }

      this.ws.onerror = (error: Event) => {
        this.status = 'disconnected'
        this.handlers.error.forEach((h) => h(error))
      }

      this.ws.onclose = () => {
        this.status = 'disconnected'
        this.stopHeartbeat()
        this.handlers.close.forEach((h) => h())

        if (!this.manualDisconnect && this.retryCount < this.options.maxRetries) {
          this.attemptReconnect()
        }
      }
    } catch (error) {
      this.handlers.error.forEach((h) =>
        h(error instanceof Error ? error : new Error(String(error)))
      )
      if (!this.manualDisconnect && this.retryCount < this.options.maxRetries) {
        this.attemptReconnect()
      }
    }
  }

  disconnect(): void {
    this.manualDisconnect = true
    this.stopHeartbeat()
    this.clearReconnectTimer()

    if (this.ws) {
      this.ws.onclose = null // Suppress close handler
      this.ws.close()
      this.ws = null
    }
    this.status = 'disconnected'
    this.retryCount = 0
  }

  send(data: string | Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === 'string' ? data : JSON.stringify(data))
    } else {
      console.warn('[GatewayWS] Cannot send — WebSocket not connected')
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.message.push(handler)
  }

  onError(handler: ErrorHandler): void {
    this.handlers.error.push(handler)
  }

  onReconnect(handler: ReconnectHandler): void {
    this.handlers.reconnect.push(handler)
  }

  onOpen(handler: () => void): void {
    this.handlers.open.push(handler)
  }

  onClose(handler: () => void): void {
    this.handlers.close.push(handler)
  }

  // — private —

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat' })
    }, this.options.heartbeatInterval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private attemptReconnect(): void {
    this.retryCount++
    const delay = this.options.reconnectDelay * Math.pow(this.options.reconnectBackoff, this.retryCount - 1)
    this.status = 'reconnecting'

    this.handlers.reconnect.forEach((h) => h(this.retryCount, this.options.maxRetries))

    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}

// Singleton instance
let wsInstance: GatewayWebSocket | null = null

export function useGatewayWebSocket(options?: Partial<WsOptions>): GatewayWebSocket {
  if (!wsInstance) {
    wsInstance = new GatewayWebSocket(options)
  }
  return wsInstance
}

export function destroyGatewayWebSocket(): void {
  if (wsInstance) {
    wsInstance.disconnect()
    wsInstance = null
  }
}

export default GatewayWebSocket
