import type { ClientMessage, ServerMessage, ConnectionStatus } from './types.ts';

export interface WebSocketClientOptions {
  url?: string;
  onMessage: (message: ServerMessage) => void;
  onStatusChange: (status: ConnectionStatus) => void;
}

/**
 * Determines the default WebSocket URL dynamically from current window location.
 */
export function getDefaultWsUrl(): string {
  if (typeof window === 'undefined') {
    return 'ws://localhost:3000/ws';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/**
 * Browser WebSocket connection manager with automatic reconnection and JSON protocol serialization.
 */
export class GameWebSocketClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly onMessage: (message: ServerMessage) => void;
  private readonly onStatusChange: (status: ConnectionStatus) => void;

  private isExplicitlyClosed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;

  constructor(options: WebSocketClientOptions) {
    this.url = options.url || getDefaultWsUrl();
    this.onMessage = options.onMessage;
    this.onStatusChange = options.onStatusChange;
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isExplicitlyClosed = false;
    this.onStatusChange(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.onStatusChange('connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string) as ServerMessage;
          this.onMessage(parsed);
        } catch (err) {
          console.error('[WebSocketClient] Failed to parse server message:', err);
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        if (!this.isExplicitlyClosed) {
          this.onStatusChange('disconnected');
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[WebSocketClient] Connection error occurred:', err);
      };
    } catch (err) {
      console.error('[WebSocketClient] Connect exception:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.isExplicitlyClosed || this.reconnectTimer) {
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff capped at 5 seconds
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 5000);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  send(message: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocketClient] Cannot send; socket is not open.');
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (err) {
      console.error('[WebSocketClient] Send failed:', err);
      return false;
    }
  }

  disconnect(): void {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.onStatusChange('disconnected');
  }
}
