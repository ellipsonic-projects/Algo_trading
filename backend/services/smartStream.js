const EventEmitter = require('events');
const config = require('../config');
const orderUpdateService = require('./orderUpdateService');

class SmartStreamPool extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map(); // userId -> WebSocket instance
    this.subscribedTokens = new Map(); // userId -> Map(token -> exchangeType)
  }

  connect(userId) {
    if (!userId) return;
    const uid = String(userId);
    if (this.connections.has(uid)) {
      return; // Already connected
    }

    const WebSocketImpl = globalThis.WebSocket || require('ws');
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET || process.env.ANGEL_ONE_INTERNAL_SECRET || '';
    const wsBase = process.env.ANGEL_ONE_WS_URL || 'ws://localhost:8000';
    // Use clean path; pass authentication via WebSocket headers
    const wsUrl = `${wsBase}/ws/broker-stream?userId=${encodeURIComponent(uid)}`;

    console.log(`[SmartStreamPool] Connecting private WebSocket for user ${uid}...`);
    const ws = new WebSocketImpl(wsUrl, {
      headers: {
        'X-Internal-Token': internalSecret,
        'X-User-Id': uid
      }
    });

    this.connections.set(uid, ws);

    ws.onopen = () => {
      console.log(`[SmartStreamPool] Connected to Python stream for user ${uid}`);
      this.emit('connected', uid);
      this.resubscribeAll(uid);
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'tick') {
          this.emit('tick', payload.data, uid);
        } else if (payload.type === 'order') {
          const orderData = typeof payload.data === 'string' ? JSON.parse(payload.data) : payload.data;
          orderUpdateService.emit('order:update', orderData, uid);
        }
      } catch (err) {
        console.error(`[SmartStreamPool] Error handling message for user ${uid}:`, err.message);
      }
    };

    ws.onerror = (err) => {
      console.error(`[SmartStreamPool] Error on socket for user ${uid}:`, err.message);
    };

    ws.onclose = (event) => {
      const code = event?.code;
      console.warn(`[SmartStreamPool] Connection closed for user ${uid} (Code: ${code || 'unknown'})`);
      this.connections.delete(uid);
      this.emit('disconnected', uid);
      
      // Stop reconnecting if the session has expired or is unauthorized in Python
      if (code === 4000 || code === 4001 || code === 4003) {
        console.error(`[SmartStreamPool] Fatal websocket close code ${code} for user ${uid}. Halting reconnect loop.`);
        const BrokerConnection = require('../models/BrokerConnection');
        BrokerConnection.findOneAndUpdate({ userId: uid }, { sessionStatus: 'DISCONNECTED' }).catch(() => {});
        return;
      }

      // Auto-reconnect after 5 seconds only if subscriptions exist and connection was not explicitly deleted
      if (this.subscribedTokens.has(uid)) {
        setTimeout(() => {
          const conn = this.subscribedTokens.get(uid);
          if (conn && !this.connections.has(uid)) {
            this.connect(uid);
          }
        }, 5000);
      }
    };
  }

  subscribe(userId, tokenList) {
    const uid = String(userId);
    const ws = this.connections.get(uid);

    if (!this.subscribedTokens.has(uid)) {
      this.subscribedTokens.set(uid, new Map());
    }
    const userSubs = this.subscribedTokens.get(uid);

    for (const item of tokenList) {
      const exchType = Number(item.exchangeType);
      for (const token of item.tokens) {
        userSubs.set(String(token), exchType);
      }
    }

    if (ws && ws.readyState === 1) {
      for (const item of tokenList) {
        ws.send(JSON.stringify({
          action: 'subscribe',
          exchangeType: item.exchangeType,
          tokens: item.tokens
        }));
      }
    } else {
      // Connect if not already connected
      this.connect(uid);
    }
  }

  unsubscribe(userId, tokenList) {
    const uid = String(userId);
    const ws = this.connections.get(uid);
    const userSubs = this.subscribedTokens.get(uid);

    for (const item of tokenList) {
      for (const token of item.tokens) {
        if (userSubs) userSubs.delete(String(token));
      }
    }

    if (ws && ws.readyState === 1) {
      for (const item of tokenList) {
        ws.send(JSON.stringify({
          action: 'unsubscribe',
          exchangeType: item.exchangeType,
          tokens: item.tokens
        }));
      }
    }
  }

  resubscribeAll(userId) {
    const uid = String(userId);
    const userSubs = this.subscribedTokens.get(uid);
    if (!userSubs || userSubs.size === 0) return;

    const byExch = new Map();
    for (const [token, exchType] of userSubs.entries()) {
      if (!byExch.has(exchType)) byExch.set(exchType, []);
      byExch.get(exchType).push(token);
    }

    const tokenList = [];
    for (const [exchType, tokens] of byExch.entries()) {
      tokenList.push({ exchangeType: exchType, tokens });
    }

    this.subscribe(uid, tokenList);
  }

  disconnect(userId) {
    const uid = String(userId);
    this.subscribedTokens.delete(uid);
    const ws = this.connections.get(uid);
    if (ws) {
      this.connections.delete(uid);
      ws.close();
    }
  }
}

module.exports = new SmartStreamPool();
