'use strict';
const net = require('node:net');
const { FrameBuffer, crc16Modbus } = require('../lib/givenergy-frame');
// Loopback fixture for the existing GivModbus reader. No physical device access.
function createGatewaySimulator({serial='GW2412G068',onRequest=()=>{},registers}={}) {
  const words=registers||new Map([[1608,2418],[1616,(-3000)&65535],[1617,0],[1618,700],
    [1700,0],[1701,1],[1702,2000],[1801,91],[1816,2000]]);
  const sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    const frames=new FrameBuffer();
    socket.on('data',chunk=>{
      frames.push(chunk);let request;
      while((request=frames.popFrame())) {
        onRequest(request);
        // Only accept the exact read-only Gateway profile used by GivHome.
        const base=request.length>=34?request.readUInt16BE(28):-1,count=request.length>=34?request.readUInt16BE(30):0;
        if(request.length!==34||request[26]!==17||request[27]!==4||![[1600,20],[1700,5],[1800,20]].some(([b,c])=>b===base&&c===count)){socket.destroy();return;}
        const reply=Buffer.alloc(44+count*2);
        request.copy(reply,0,0,28);reply.writeUInt16BE(reply.length-6,4);
        reply.write(serial,28,10,'ascii');reply.writeUInt16BE(base,38);reply.writeUInt16BE(count,40);
        for(let i=0;i<count;i++)reply.writeUInt16BE(words.get(base+i)||0,42+i*2);
        const crc=crc16Modbus(reply.subarray(26,reply.length-2));reply.writeUInt16LE(crc,reply.length-2);
        socket.write(reply);
      }
    });
  });
  server.closeClients=()=>{for(const socket of sockets)socket.destroy();};
  return server;
}
if(require.main===module){
  const port=Number(process.argv[2]||8899);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Choose a simulator port between 1024 and 65535');
  const server=createGatewaySimulator();
  server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`Synthetic Gateway only: 127.0.0.1:${port}. No equipment connected.`));
  const stop=()=>{server.closeClients();server.close();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
module.exports={createGatewaySimulator};
