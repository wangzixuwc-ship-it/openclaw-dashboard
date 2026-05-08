import { getAuthToken } from '../config/auth'

// Build WebSocket URL (direct to gateway, no Vite proxy for WS).
function buildWsUrl(): string {
  const rawWsUrl = import.meta.env.VITE_WS_URL
  const rawGatewayUrl = import.meta.env.VITE_GATEWAY_URL

  let baseUrl: string

  if (rawWsUrl) {
    baseUrl = rawWsUrl
  } else if (rawGatewayUrl) {
    baseUrl = rawGatewayUrl.replace(/^http(s?)?:/, 'ws$1:')
  } else {
    baseUrl = 'ws://127.0.0.1:18789'
  }

  const token = getAuthToken()
  if (token) {
    return `${baseUrl}/ws?token=${encodeURIComponent(token)}`
  }
  console.warn('[GatewayWS] No auth token — connecting without authentication')
  return `${baseUrl}/ws`
}

export type WsMessage = Record<string, unknown>

export interface SessionStateEvent {
  key: string
  state: 'idle' | 'waiting' | 'processing' | string
  ts?: number
  queueDepth?: number
  reason?: string
}

type MessageHandler = (event: WsMessage) => void
type ErrorHandler = (error: Event | Error) => void
type ReconnectHandler = (attempt: number, maxRetries: number) => void
type SessionStateHandler = (event: SessionStateEvent) => void

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
  request: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>
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
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
    timeout: ReturnType<typeof setTimeout>
  }>()
  private handlers: {
    message: MessageHandler[]
    error: ErrorHandler[]
    reconnect: ReconnectHandler[]
    open: (() => void)[]
    close: (() => void)[]
    sessionState: SessionStateHandler[]
  } = {
    message: [],
    error: [],
    reconnect: [],
    open: [],
    close: [],
    sessionState: [],
  }
  private status: WsConnection['status'] = 'disconnected'
  private options: Required<WsOptions>
  private manualDisconnect = false
  private handshakeDone = false
  private requestIdCounter = 0

  constructor(options: Partial<WsOptions> = {}) {
    this.options = { ...defaultOptions, ...options }
  }

  get is() {
    return this.status
  }

  private nextRequestId(): string {
    return `req-${++this.requestIdCounter}-${Date.now()}`
  }

  request(method: string, params: Record<string, unknown> = {}, timeoutMs = 10000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        reject(new Error('[GatewayWS] Cannot send request — not connected'))
        return
      }

      const id = this.nextRequestId()
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`[GatewayWS] Request timeout: ${method}`))
      }, timeoutMs)

      this.pendingRequests.set(id, { resolve, reject, timeout })
      this.send({ type: 'req', id, method, params })
    })
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    this.status = 'connecting'
    this.manualDisconnect = false
    this.handshakeDone = false

    const url = buildWsUrl()

    try {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        this.retryCount = 0
      }

      this.ws.onmessage = (event: MessageEvent) => {
        let data: WsMessage
        try {
          data = JSON.parse(event.data as string)
        } catch {
          data = { raw: event.data }
        }


        // Step 1: Handle connect.challenge from server
        if (data?.type === 'event' && data?.event === 'connect.challenge') {
          const payload = data.payload as Record<string, unknown>
          const nonce = (payload?.nonce as string) || ''

          // For browser-based Control UI, use 'gateway-client' as client ID
          // This is a trusted local client that can omit device identity when authenticating with shared token
          // See: https://docs.openclaw.ai/gateway/protocol (Trusted same-process backend clients section)
          const connectReq = {
            type: 'req',
            id: `ws-${Date.now()}`,
            method: 'connect',
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'gateway-client',  // Trusted backend client - can omit device on localhost
                version: '1.0.0',
                platform: 'web',
                mode: 'backend',  // Backend mode for gateway-client
              },
              role: 'operator',
              scopes: ['operator.read', 'operator.write', 'operator.admin'],
              auth: { token: getAuthToken() || '' },
            },
          }
          this.send(connectReq)
          return
        }

        // Step 2: Handle connect response (hello-ok)
        if (data?.type === 'res' && data?.ok === true && data?.payload?.type === 'hello-ok') {
          this.handshakeDone = true
          this.status = 'connected'
          this.startHeartbeat()
          const features = (data.payload as Record<string, unknown>).features as Record<string, unknown> | undefined
          if (features?.methods) {
            console.log('[GatewayWS] Available methods:', features.methods)
          }
          const auth = (data.payload as Record<string, unknown>).auth as Record<string, unknown> | undefined
          if (auth) {
            console.log('[GatewayWS] Granted auth:', auth)
          }
          this.handlers.open.forEach((h) => h())
          return
        }

        // Handle pending request responses
        if (data?.type === 'res' && data?.id && this.pendingRequests.has(data.id as string)) {
          const pending = this.pendingRequests.get(data.id as string)!
          clearTimeout(pending.timeout)
          this.pendingRequests.delete(data.id as string)
          if (data.ok === true) {
            pending.resolve(data)
          } else {
            pending.reject(new Error(`[GatewayWS] Request failed: ${JSON.stringify(data)}`))
          }
          return
        }

        // Handle connect error
        if (data?.type === 'res' && data?.ok === false) {
          console.error('[GatewayWS] Handshake failed:', JSON.stringify(data, null, 2))
          this.ws?.close()
          return
        }

        // Ignore heartbeat
        if (data?.type === 'heartbeat' || data?.type === 'ping') {
          this.send({ type: 'pong' })
          return
        }

        // sessions.changed events (session metadata/state changes - automatically broadcast)
        // Format: { type: 'event', event: 'sessions.changed', payload: { sessions: [...] } }
        if (data?.type === 'event' && data?.event === 'sessions.changed') {
          // Notify handlers - agent.ts will handle the payload
          const payload = data?.payload as Record<string, unknown>
          if (payload?.sessions) {
            this.handlers.message.forEach((h) => h(data))
          }
        }

        // session.state events (diagnostic only - may not be pushed, see Issue #17057)
        // Format: { type: 'event', event: 'session.state', key, state, ts, ... }
        if (data?.type === 'event' && data?.event === 'session.state') {
          const key = data.key as string
          const state = data.state as string
          if (key && state) {
            this.handlers.sessionState.forEach((h) =>
              h({ key, state, ts: data.ts as number, queueDepth: data.queueDepth as number, reason: data.reason as string })
            )
          }
        }

        this.handlers.message.forEach((h) => h(data))
      }

      this.ws.onerror = (error: Event) => {
        console.error('[GatewayWS] Error:', error)
        this.status = 'disconnected'
        this.handlers.error.forEach((h) => h(error))
      }

      this.ws.onclose = (event: CloseEvent) => {
        this.status = 'disconnected'
        this.stopHeartbeat()
        this.handlers.close.forEach((h) => h())

        if (!this.manualDisconnect && this.retryCount < this.options.maxRetries) {
          this.attemptReconnect()
        }
      }
    } catch (error) {
      console.error('[GatewayWS] Failed to create WS:', error)
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
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    this.status = 'disconnected'
    this.retryCount = 0
    this.handshakeDone = false
  }

  send(data: string | Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const msg = typeof data === 'string' ? data : JSON.stringify(data)
      this.ws.send(msg)
    } else {
      console.warn('[GatewayWS] Cannot send — not connected')
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

  onSessionState(handler: SessionStateHandler): void {
    this.handlers.sessionState.push(handler)
  }

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
