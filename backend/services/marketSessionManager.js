const EventEmitter = require('events');
const config = require('../config');

class MarketSessionManager extends EventEmitter {
  constructor() {
    super();
    this.isOpen = false;
    this.checkTimer = null;
  }

  getIstDate(d = new Date()) {
    const utcMs = d.getTime() + (d.getTimezoneOffset() * 60000);
    return new Date(utcMs + (5.5 * 3600000));
  }

  isTradingDay(d = new Date()) {
    const ist = this.getIstDate(d);
    const day = ist.getDay();
    // Monday = 1, Friday = 5. Weekends: Sunday = 0, Saturday = 6
    return day >= 1 && day <= 5;
  }

  isMarketOpen(d = new Date()) {
    if (!this.isTradingDay(d)) return false;

    const ist = this.getIstDate(d);
    const hours = ist.getHours();
    const minutes = ist.getMinutes();
    const currentMins = (hours * 60) + minutes;

    const [openH, openM] = config.MARKET.OPEN_TIME.split(':').map(Number);
    const [closeH, closeM] = config.MARKET.CLOSE_TIME.split(':').map(Number);

    const openMins = (openH * 60) + openM;
    const closeMins = (closeH * 60) + closeM;

    return currentMins >= openMins && currentMins < closeMins;
  }

  startMonitoring() {
    if (this.checkTimer) return;

    this.isOpen = this.isMarketOpen();

    this.checkTimer = setInterval(() => {
      const currentOpen = this.isMarketOpen();
      if (currentOpen !== this.isOpen) {
        this.isOpen = currentOpen;
        if (this.isOpen) {
          console.log('[MarketSessionManager] Market OPENED event emitted');
          this.emit('market:opened');
        } else {
          console.log('[MarketSessionManager] Market CLOSED event emitted');
          this.emit('market:closed');
        }
      }
    }, 10_000);
  }

  stopMonitoring() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }
}

module.exports = new MarketSessionManager();
