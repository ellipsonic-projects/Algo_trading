const EventEmitter = require('events');
const mongoose = require('mongoose');
const config = require('../config');

class HealthMonitorService extends EventEmitter {
  constructor() {
    super();
    this.checkTimer = null;
    this.lastHealthState = {
      pythonApi: false,
      mongoDb: false,
      lastCheck: null,
      rttMs: 0
    };
  }

  async checkHealth() {
    const state = {
      pythonApi: false,
      mongoDb: false,
      lastCheck: new Date().toISOString(),
      rttMs: 0
    };

    // 1. Check MongoDB
    state.mongoDb = mongoose.connection.readyState === 1;

    // 2. Check Python Wrapper /health endpoint
    const startMs = Date.now();
    try {
      const res = await fetch(`${config.API.ANGEL_ONE_API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        state.pythonApi = true;
        state.rttMs = Date.now() - startMs;
      }
    } catch (err) {
      state.pythonApi = false;
    }

    this.lastHealthState = state;

    if (!state.pythonApi || !state.mongoDb) {
      console.warn('[HealthMonitor] System Health Warning:', state);
      this.emit('health:warning', state);
    } else {
      this.emit('health:ok', state);
    }

    return state;
  }

  start(intervalMs = 15_000) {
    if (this.checkTimer) return;
    this.checkHealth();
    this.checkTimer = setInterval(() => this.checkHealth(), intervalMs);
  }

  stop() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  getStatus() {
    return this.lastHealthState;
  }
}

module.exports = new HealthMonitorService();
