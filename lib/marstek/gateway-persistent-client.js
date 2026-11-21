'use strict';
const net = require('node:net');
const { FrameBuffer, parseFrame, buildReadInputRegistersFrame, crc16Modbus } = require('../givenergy-frame');
const { leaseGiv } = require('./communications');
const BANKS = [[1616, 3], [1700, 3], [1800, 20]];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Gateway collector only. AIO transport, control writes and setup checks retain
// their existing clients. Keep the socket, not the shared communications lease.
class GatewayPersistentReadOnlyClient {
  constructor(options = {}) {
    this.host = options.host;
    this.port = options.port ?? 8899;
    this.expectedSerial = options.expectedSerial;
    this.deviceAddress = 17;
    this.adapterSerial = options.adapterSerial;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000;
    this.readTimeoutMs = options.readTimeoutMs ?? 3000;
    this.requestGapMs = options.requestGapMs ?? 250;
    this.givLeaseOptions = options.givLeaseOptions;
    this.onTransportEvent = options.onTransportEvent;
    this.onGracefulContinuityEvent = options.onGracefulContinuityEvent;
    this.acquire = options.acquire || leaseGiv;
    this.socket = null;
    this.pending = null;
    this.generation = 0;
    this.lastTxAtMs = 0;
    this.oldestSends = new Map();
    this.tail = Promise.resolve();
    this.queued = 0;
  }
  event(e) { try { this.onTransportEvent?.(e); } catch { /* Evidence cannot alter transport. */ } }
  recovery(e) { try { this.onGracefulContinuityEvent?.(e); } catch { /* As above. */ } }
  readInputRegisters(base, count) {
    if (!this.host || !this.expectedSerial || !BANKS.some(([b, n]) => b === base && n === count)) return Promise.reject(Error('Gateway read-only profile refused request'));
    if (this.queued >= 8) return Promise.reject(Error('Gateway read queue full'));
    const generation = this.generation;
    const queuedAt = Date.now();
    this.queued++;
    const operation = this.tail.then(async () => {
      if (generation !== this.generation || Date.now() - queuedAt > 6000) throw Error('Gateway read expired or stopped');
      let lastError;
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (generation !== this.generation) throw Error('Gateway collector stopped');
        try {
          const result = await this.attempt(base, count, generation);
          this.recovery({ phase: 'read', label: `IR(${base},${count})`, opportunity: attempt, opportunityKind: 'persistent', result: 'ok', recovered: attempt > 1 });
          return result;
        } catch (error) {
          lastError = error;
          this.recovery({ phase: 'read', label: `IR(${base},${count})`, opportunity: attempt, opportunityKind: 'persistent', result: 'fail', error: error.message });
          if (error.identityFault || generation !== this.generation) throw error;
        }
      }
      throw lastError;
    }).finally(() => { this.queued--; });
    this.tail = operation.catch(() => {});
    return operation;
  }
  async attempt(base, count, generation) {
    const queuedAt = Date.now();
    const options = typeof this.givLeaseOptions === 'function' ? this.givLeaseOptions() : this.givLeaseOptions;
    const release = await this.acquire(this.host, options);
    const leaseStartedAtMs = Date.now();
    this.event({ phase: 'queue-acquired', elapsedMs: Date.now() - queuedAt });
    try {
      if (generation !== this.generation) throw Error('Gateway collector stopped');
      const socket = await this.connect(generation);
      const wait = this.requestGapMs - (Date.now() - this.lastTxAtMs);
      if (wait > 0) await pause(wait);
      if (generation !== this.generation || socket.destroyed || socket !== this.socket) throw Error('Gateway connection closed');
      const request = buildReadInputRegistersFrame({ adapterSerial: this.adapterSerial, deviceAddress: 17, base, count });
      const requestSentAtMs = Date.now();
      return await new Promise((resolve, reject) => {
        const finish = (error, result) => {
          if (this.pending?.finish !== finish) return;
          clearTimeout(this.pending.timer);
          this.pending = null;
          if (error) reject(error); else resolve(result);
        };
        const timer = setTimeout(() => { this.event({ phase: 'read-timeout', base, count }); finish(Error('Gateway response timed out')); }, Math.max(1, Math.min(this.readTimeoutMs, 5500 - (Date.now() - leaseStartedAtMs))));
        this.pending = { base, count, requestSentAtMs, socket, generation, finish, timer };
        this.lastTxAtMs = requestSentAtMs;
        const key = `${base}:${count}`;
        if (!this.oldestSends.has(key)) this.oldestSends.set(key, requestSentAtMs);
        this.event({ phase: 'request-sent', base, count, requestSentAtMs });
        socket.write(request, error => { if (error) this.drop(socket, error); });
      });
    } finally { release(); }
  }
  async connect(generation) {
    if (this.socket && !this.socket.destroyed && !this.socket.connecting) return this.socket;
    const at = Date.now();
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      this.socket = socket;
      const frames = new FrameBuffer();
      let settled = false;
      const timer = setTimeout(() => this.drop(socket, Error('Gateway connect timed out')), this.connectTimeoutMs);
      const failConnect = error => {
        if (settled) return;
        settled = true; clearTimeout(timer); reject(error);
      };
      socket.on('error', error => { failConnect(error); this.drop(socket, error); });
      socket.on('close', () => { failConnect(Error('Gateway connection closed')); this.drop(socket, Error('Gateway connection closed')); });
      socket.on('connect', () => {
        if (generation !== this.generation) { failConnect(Error('Gateway collector stopped')); this.drop(socket); return; }
        settled = true; clearTimeout(timer); socket.setKeepAlive(true, 30000); socket.unref();
        this.event({ phase: 'connected', elapsedMs: Date.now() - at }); resolve(socket);
      });
      socket.on('data', chunk => {
        if (socket !== this.socket || generation !== this.generation) return;
        try {
          frames.push(chunk); let raw;
          while ((raw = frames.popFrame())) this.receive(socket, raw);
        } catch (error) { this.event({ phase: 'frame-rejected', reason: error.message }); this.drop(socket, error); }
      });
    });
  }
  receive(socket, raw) {
    if (socket !== this.socket || raw[2] !== 0 || raw[3] !== 1 || raw[6] !== 1) { this.event({ phase: 'frame-rejected', reason: 'header' }); return; }
    if (raw[7] === 1) {
      if (raw.length !== 19) { this.event({ phase: 'frame-rejected', reason: 'heartbeat-length' }); return; }
      socket.write(raw, error => { if (error) this.drop(socket, error); });
      this.event({ phase: 'heartbeat-echoed' }); return;
    }
    if (raw[7] !== 2 || raw.length < 44 || crc16Modbus(raw.subarray(26, -2)) !== raw.readUInt16LE(raw.length - 2)) {
      this.event({ phase: 'frame-rejected', reason: 'function-or-crc' }); return;
    }
    const response = parseFrame(raw);
    const p = this.pending;
    if (!p || p.socket !== socket || p.generation !== this.generation) { this.event({ phase: 'unmatched-response', reason: 'no-request' }); return; }
    if (response.deviceAddress !== 17) { this.event({ phase: 'frame-rejected', reason: 'slave' }); return; }
    if (response.inverterSerial !== this.expectedSerial) {
      const error = Error('Gateway response identity/range mismatch'); error.identityFault = true;
      this.event({ phase: 'frame-rejected', reason: 'serial', result: 'fail', identityFault: true }); p.finish(error); this.drop(socket, error); return;
    }
    if (raw[27] !== 4 || response.baseRegister !== p.base || response.registerCount !== p.count || response.values.length !== p.count || raw.length !== 44 + p.count * 2) {
      this.event({ phase: 'unmatched-response', reason: 'function-or-range' }); return;
    }
    // The protocol cannot identify a late response from an earlier same-bank
    // request. Retain the earliest outstanding send time to avoid making it young.
    const key = `${p.base}:${p.count}`;
    response.requestSentAtMs = Math.min(p.requestSentAtMs, this.oldestSends.get(key) ?? p.requestSentAtMs);
    this.oldestSends.delete(key);
    this.event({ phase: 'wire-response', base: p.base, count: p.count, requestSentAtMs: response.requestSentAtMs, elapsedMs: Date.now() - response.requestSentAtMs });
    p.finish(null, response);
  }
  drop(socket, error = Error('Gateway connection closed')) {
    if (socket === this.socket) { this.socket = null; this.oldestSends.clear(); }
    if (this.pending?.socket === socket) this.pending.finish(error);
    if (!socket.destroyed) socket.destroy();
  }
  close() { this.generation++; if (this.socket) this.drop(this.socket, Error('Gateway collector stopped')); }
}
module.exports = { GatewayPersistentReadOnlyClient };
