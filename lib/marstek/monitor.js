'use strict';
const { EventEmitter } = require('node:events');
const { ReadOnlyModbusTcpClient } = require('./modbus-tcp');
const { readSnapshot } = require('./venus-e3');
class VenusMonitor extends EventEmitter {
  constructor(config, { clientFactory = options => new ReadOnlyModbusTcpClient(options), now = Date.now } = {}) {
    super(); Object.assign(this, { config, clientFactory, now });
    this.running = false; this.sample = null; this.lastError = ''; this.failures = 0;
    this.timer = null; this.client = null; this.inFlight = null;
  }
  state() {
    const ageMs = this.sample ? Math.max(0, this.now() - this.sample.model.observedAtMs) : null;
    const stale = ageMs === null || ageMs >= this.config.staleAfterSeconds * 1000;
    return { id: this.config.id, sample: this.sample, ageMs, stale,
      status: this.sample ? (stale ? 'stale' : (this.failures ? 'retrying' : 'online')) : (this.lastError ? 'offline' : 'starting'),
      lastError: this.lastError, failures: this.failures };
  }
  start() { if (this.running) return; this.running = true; void this.cycle(); }
  async cycle() {
    const started = this.now();
    await this.pollOnce();
    if (!this.running) return;
    const delay = this.failures ? Math.min(60, 5 * 2 ** Math.min(this.failures - 1, 4)) : this.config.pollIntervalSeconds;
    this.timer = setTimeout(() => { void this.cycle(); }, Math.max(100, delay * 1000 - (this.now() - started)));
    this.timer.unref?.();
  }
  pollOnce() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.read().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  async read() {
    const client = this.clientFactory(this.config);
    this.client = client;
    const deadline = setTimeout(() => client.close(), 3000);
    try {
      const sample = await readSnapshot(client, { thresholdW: this.config.thresholdW, now: this.now });
      if (this.client !== client) return this.state();
      this.sample = sample; this.failures = 0; this.lastError = '';
    } catch (error) {
      if (this.client !== client) return this.state();
      this.failures++; this.lastError = error.message;
    } finally { clearTimeout(deadline); client.close(); if (this.client === client) this.client = null; }
    const state = this.state(); this.emit('state', state); return state;
  }
  stop() {
    this.running = false; clearTimeout(this.timer); this.timer = null;
    const client = this.client; this.client = null; client?.close();
  }
}
module.exports = { VenusMonitor };
