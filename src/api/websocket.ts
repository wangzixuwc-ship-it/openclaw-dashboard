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

  constructor(options: Partial<WsOptions> = {}) {
    this.options = { ...defaultOptions, ...options }
  }

  get is() {
    return this.status
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[GatewayWS] Already connected, skipping')
      return
    }

    this.status = 'connecting'
    this.manualDisconnect = false
    this.handshakeDone = false

    const url = buildWsUrl()
    console.log('[GatewayWS] Connecting to:', url)

    try {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        console.log('[GatewayWS] WebSocket opened, waiting for server challenge...')
        this.retryCount = 0
      }

      this.ws.onmessage = (event: MessageEvent) => {
        let data: WsMessage
        try {
          data = JSON.parse(event.data as string)
        } catch {
          data = { raw: event.data }
        }

        console.log('[GatewayWS] Message:', JSON.stringify(data, null, 2))

        // Step 1: Handle connect.challenge from server
        if (data?.type === 'event' && data?.event === 'connect.challenge') {
          const payload = data.payload as Record<string, unknown>
          const nonce = (payload?.nonce as string) || ''
          console.log('[GatewayWS] Got challenge, nonce:', nonce)

          // Send connect request (token-based auth)
          // Minimal connect - let gateway validate and tell us what client ID it expects
          const connectReq = {
            type: 'req',
            id: `ws-${Date.now()}`,
            method: 'connect',
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              role: 'operator',
              scopes: ['operator.read', 'operator.write'],
              auth: { token: getAuthToken() || '' },
            },
          }
          console.log('[GatewayWS] Sending connect request:', JSON.stringify(connectReq))
          this.send(connectReq)
          return
        }

        // Step 2: Handle connect response (hello-ok)
        if (data?.type === 'res' && data?.id && data?.ok === true) {
          console.log('[GatewayWS] Handshake successful!')
          this.handshakeDone = true
          this.status = 'connected'
          this.startHeartbeat()
          this.handlers.open.forEach((h) => h())

          // Now safe to subscribe to session events
          console.log('[GatewayWS] Subscribing to sessions...')
          this.send({ type: 'sessions.subscribe' })
          return
        }

        // Handle connect error
        if (data?.type === 'res' && data?.ok === false) {
          console.error('[GatewayWS] Handshake failed:', data)
          this.ws?.close()
          return
        }

        // Ignore heartbeat
        if (data?.type === 'heartbeat' || data?.type === 'ping') {
          this.send({ type: 'pong' })
          return
        }

        // session.state events (authoritative status from gateway)
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
        console.log('[GatewayWS] Closed:', { code: event.code, reason: event.reason, clean: event.wasClean })
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
      console.log('[GatewayWS] Sending:', msg)
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
    console.log(`[GatewayWS] Reconnecting (${this.retryCount}/${this.options.maxRetries}) in ${delay}ms...`)

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
