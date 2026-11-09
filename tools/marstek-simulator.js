'use strict';
const net = require('node:net');
function fixture({ soc = 725, power = 500, deviceName = 'VenusE 3.0' } = {}) {
  const map = new Map([[30001, power & 65535], [30006, (-power) & 65535], [34002, soc], [35000, 235], [32200, 2301]]);
  const name = Buffer.alloc(20); name.write(deviceName);
  for (let i = 0; i < 10; i++) map.set(31000 + i, name.readUInt16BE(i * 2));
  [150, 0, 116, 0, 118].forEach((value, i) => map.set(30200 + i, value));
  return map;
}
function createSimulator({ registers = fixture(), onRequest = () => {}, response = frame => frame } = {}) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 4096) return socket.destroy();
      while (buffer.length >= 7) {
        const size = buffer.readUInt16BE(4) + 6;
        if (size < 8 || size > 260) return socket.destroy();
        if (buffer.length < size) return;
        const request = buffer.subarray(0, size); buffer = buffer.subarray(size);
        onRequest(request);
        const fn = request[7];
        const address = request.length === 12 ? request.readUInt16BE(8) : 0;
        const count = request.length === 12 ? request.readUInt16BE(10) : 0;
        let exception = fn !== 3 ? 1 : (request.length !== 12 || count < 1 || count > 32 ? 3 : 0);
        const words = Array.from({ length: Math.min(count, 32) }, (_, i) => registers.get(address + i));
        if (!exception && words.some(value => value === undefined)) exception = 2;
        const reply = Buffer.alloc(exception ? 9 : 9 + count * 2);
        request.copy(reply, 0, 0, 4); reply.writeUInt16BE(reply.length - 6, 4); reply[6] = request[6];
        reply[7] = exception ? fn | 128 : fn; reply[8] = exception || count * 2;
        if (!exception) words.forEach((word, i) => reply.writeUInt16BE(word, 9 + i * 2));
        const output = response(reply, request, socket);
        if (output) socket.write(output);
      }
    });
  });
  server.closeClients = () => { for (const socket of sockets) socket.destroy(); };
  return server;
}
if (require.main === module) {
  const port = process.argv[2] === undefined ? 15020 : Number(process.argv[2]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a simulator port between 1024 and 65535');
  const server = createSimulator();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Simulated Venus E 3.0 only: 127.0.0.1:${port}; SOC 72.5%; charging 500 W. No physical device connected.`));
  const stop = () => { server.closeClients(); server.close(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
module.exports = { fixture, createSimulator };
