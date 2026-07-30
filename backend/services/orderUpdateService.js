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
    this.reconnectAttempts = 0;
  }

  connect(jwtToken) {
    if (jwtToken) {
      this.jwtToken = jwtToken;
    }

    if (!this.jwtToken) {
      console.warn('[OrderUpdateService] Cannot connect without jwtToken');
      return;
    }

    this.disconnect(false);

    try {
      const WebSocketImpl = globalThis.WebSocket || require('ws');
      const wsUrl = 'wss://tns.angelone.in/smart-order-update';

      console.log('[OrderUpdateService] Connecting to Order Update WebSocket...');
      this.ws = new WebSocketImpl(wsUrl, {
        headers: {
          Authorization: `Bearer ${this.jwtToken}`
        }
      });

      this.ws.onopen = () => {
        console.log('[OrderUpdateService] Order Update WebSocket connected');
        this.isConnected = true;
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
        this.scheduleReconnect();
      };
    } catch (err) {
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
        console.log(`[OrderUpdateService] Order Update: ${orderData.orderid} -> Status: ${orderData.status || orderData.orderstatus}`);
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
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  disconnect(clearToken = true) {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
    if (this.ws) {
      try {
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
