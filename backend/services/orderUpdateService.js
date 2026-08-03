const EventEmitter = require('events');
const config = require('../config');

class OrderUpdateService extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.jwtToken = null;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.isExplicitDisconnect = false;
  }

  connect(jwtToken) {
    if (jwtToken) {
      this.jwtToken = jwtToken;
    }

    if (!this.jwtToken) {
      console.warn('[OrderUpdateService] Cannot connect without jwtToken');
      return;
    }

    if (this.isConnected || this.isConnecting) {
      if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
        return; // Already connecting or connected
      }
    }

    this.disconnect(false);
    this.isExplicitDisconnect = false;

    try {
      const WebSocketImpl = globalThis.WebSocket || require('ws');
      const wsUrl = 'wss://tns.angelone.in/smart-order-update';

      console.log('[OrderUpdateService] Connecting to Order Update WebSocket...');
      this.isConnecting = true;
      this.ws = new WebSocketImpl(wsUrl, {
        headers: {
          Authorization: `Bearer ${this.jwtToken}`
        }
      });

      this.ws.onopen = () => {
        console.log('[OrderUpdateService] Order Update WebSocket connected');
        this.isConnected = true;
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.startKeepalive();
        this.emit('connected');
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (err) => {
        console.error('[OrderUpdateService] WebSocket error:', err.message || err);
      };

      this.ws.onclose = (event) => {
        console.warn(`[OrderUpdateService] WebSocket closed (code: ${event.code})`);
        this.cleanup();
        if (!this.isExplicitDisconnect) {
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      this.isConnecting = false;
      console.error('[OrderUpdateService] Error initiating WebSocket:', err.message);
      this.scheduleReconnect();
    }
  }

  startKeepalive() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.ws && this.isConnected) {
        try {
          this.ws.send('ping');
        } catch (e) {
          console.warn('[OrderUpdateService] Ping failed:', e.message);
        }
      }
    }, 10000);
  }

  handleMessage(data) {
    if (data === 'pong' || data === 'ping') return;

    try {
      const payload = typeof data === 'string' ? JSON.parse(data) : JSON.parse(data.toString());
      if (payload && payload.orderData) {
        const orderData = payload.orderData;
        const orderId = orderData.orderid || orderData.orderId || orderData.uniqueorderid || 'N/A';
        const status = orderData.status || orderData.orderstatus || orderData.orderStatus || 'N/A';
        console.log(`[OrderUpdateService] Order Update: ${orderId} -> Status: ${status}`);
        this.emit('order:update', orderData);
      }
    } catch (err) {
      console.error('[OrderUpdateService] Error parsing order message:', err.message);
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`[OrderUpdateService] Scheduling reconnect in ${delay}ms (Attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  cleanup() {
    this.isConnected = false;
    this.isConnecting = false;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  disconnect(clearToken = true) {
    this.isExplicitDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    if (clearToken) {
      this.jwtToken = null;
    }
  }
}

module.exports = new OrderUpdateService();
