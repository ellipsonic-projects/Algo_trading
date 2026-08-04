const EventEmitter = require('events');

class OrderUpdateService extends EventEmitter {
  constructor() {
    super();
    this.isConnected = true;
    this.isConnecting = false;
  }

  // Backward-compatible placeholders (actual connection is managed via SmartStreamPool)
  connect(jwtToken, userId = 'default') {
    this.isConnected = true;
    this.isConnecting = false;
    const smartStream = require('./smartStream');
    if (userId && userId !== 'default') {
      smartStream.connect(userId);
    }
  }

  disconnect(userId = 'default') {
    // No-op since smartStream close handles it, but keeps signature
  }

  // Public message handler for testing/simulation compatibility
  handleMessage(data, userId = 'default') {
    try {
      const payload = typeof data === 'string' ? JSON.parse(data) : data;
      this.emit('order:update', payload, userId);
    } catch (e) {
      console.error('[OrderUpdateService] Error parsing direct message:', e.message);
    }
  }
}

module.exports = new OrderUpdateService();
