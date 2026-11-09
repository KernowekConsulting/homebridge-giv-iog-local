'use strict';
const net = require('node:net');

// Standard Modbus TCP, separate from GivEnergy's proprietary framing.
// Only FC03 is implemented. There is deliberately no arbitrary request/write API.
class ReadOnlyModbusTcpClient {
  constructor({ host, port = 502, unitId = 1, timeoutMs = 3000 }) {
    if (typeof host !== 'string' || !host.trim()) throw new Error('Marstek host is required');
    for (const [key, value, min, max] of [['port', port, 1, 65535], ['unitId', unitId, 1, 247], ['timeoutMs', timeoutMs, 50, 30000]]) {
      if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid Marstek ${key}`);
    }
    Object.assign(this, { host, port, unitId, timeoutMs });
    this.sequence = 0;
    this.tail = Promise.resolve();
    this.closed = false;
    this.socket = null;
    this.pending = null;
  }
  readHoldingRegisters(address, count) {
    if (!Number.isInteger(address) || address < 0 || !Number.isInteger(count) || count < 1 || count > 32 || address + count > 65536) {
      return Promise.reject(new Error('Invalid Marstek register range (maximum 32 words)'));
    }
    const task = this.tail.then(() => this.read(address, count));
    this.tail = task.catch(() => {});
    return task;
  }
  async read(address, count) {
    if (this.closed) throw new Error('Marstek client is closed');
    if (!this.socket) await this.connect();
    if (this.closed) throw new Error('Marstek client is closed');
    const transaction = this.sequence = (this.sequence + 1) & 0xffff;
    const request = Buffer.alloc(12);
    request.writeUInt16BE(transaction, 0);
    request.writeUInt16BE(6, 4);
    request[6] = this.unitId;
    request[7] = 3;
    request.writeUInt16BE(address, 8);
    request.writeUInt16BE(count, 10);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('Marstek response timed out')), this.timeoutMs);
      this.pending = { resolve, reject, timer, transaction, count };
      this.socket.write(request, error => { if (error) this.fail(error); });
    });
  }
  connect() {
    return new Promise((resolve, reject) => {
      const socket = this.socket = new net.Socket();
      this.buffer = Buffer.alloc(0);
      let connecting = true;
      const timer = setTimeout(() => this.fail(new Error('Marstek connection timed out')), this.timeoutMs);
      this.connectReject = error => { if (connecting) { connecting = false; clearTimeout(timer); reject(error); } };
      socket.on('error', error => { if (this.socket === socket) this.fail(error); });
      socket.on('close', () => { if (this.socket === socket) this.fail(new Error('Marstek connection closed')); });
      socket.on('data', chunk => { if (this.socket === socket) this.receive(chunk); });
      socket.connect({ host: this.host, port: this.port }, () => {
        if (!connecting) return;
        connecting = false;
        clearTimeout(timer);
        this.connectReject = null;
        socket.setNoDelay(true);
        resolve();
      });
    });
  }
  receive(chunk) {
    if (!this.pending) return this.fail(new Error('Unexpected Marstek response'));
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 260) return this.fail(new Error('Oversized Marstek response'));
    if (this.buffer.length < 7) return;
    const p = this.pending;
    const length = this.buffer.readUInt16BE(4);
    if (this.buffer.readUInt16BE(0) !== p.transaction || this.buffer.readUInt16BE(2) !== 0 || this.buffer[6] !== this.unitId || length < 3 || length > 254) {
      return this.fail(new Error('Invalid Marstek response header'));
    }
    if (this.buffer.length < length + 6) return;
    if (this.buffer.length !== length + 6) return this.fail(new Error('Unexpected trailing Marstek frame'));
    const response = this.buffer;
    if (response[7] === 0x83) return this.fail(new Error(`Marstek Modbus exception ${response[8]}`));
    if (response[7] !== 3 || response[8] !== p.count * 2 || length !== 3 + p.count * 2) {
      return this.fail(new Error('Invalid Marstek register response'));
    }
    const words = Array.from({ length: p.count }, (_, i) => response.readUInt16BE(9 + i * 2));
    clearTimeout(p.timer);
    this.pending = null;
    this.buffer = Buffer.alloc(0);
    p.resolve(words);
  }
  fail(error) {
    const socket = this.socket;
    this.socket = null;
    if (socket) socket.destroy();
    if (this.connectReject) { const reject = this.connectReject; this.connectReject = null; reject(error); }
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
  close() { this.closed = true; this.fail(new Error('Marstek client closed')); }
}
module.exports = { ReadOnlyModbusTcpClient };
