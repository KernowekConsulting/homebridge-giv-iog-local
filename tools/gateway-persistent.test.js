'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net');
const {FrameBuffer,crc16Modbus}=require('../lib/givenergy-frame');
const {GatewayPersistentReadOnlyClient:Client}=require('../lib/marstek/gateway-persistent-client');
const {Broker}=require('../lib/marstek/communications');
function reply(q,{serial='GW2412G068',slave=17,base=q.readUInt16BE(28),count=q.readUInt16BE(30),badCrc=false}={}){
 const r=Buffer.alloc(44+count*2);q.copy(r,0,0,28);r[26]=slave;r.writeUInt16BE(r.length-6,4);r.write(serial,28,10,'ascii');r.writeUInt16BE(base,38);r.writeUInt16BE(count,40);for(let i=0;i<count;i++)r.writeUInt16BE(i===1?1:0,42+i*2);r.writeUInt16LE(crc16Modbus(r.subarray(26,-2))^(badCrc?1:0),r.length-2);return r;
}
async function rig(t,onRequest){const sockets=new Set(),events=[],requests=[];let connections=0,heartbeats=0;const timers=[];
 const server=net.createServer(s=>{connections++;sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));const f=new FrameBuffer();s.on('data',b=>{f.push(b);let q;while((q=f.popFrame())){if(q[7]===1){heartbeats++;continue;}assert.equal(q[27],4,'physical write forbidden');requests.push(q);onRequest?.(s,q,requests.length);}});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const c=new Client({host:'127.0.0.1',port:server.address().port,expectedSerial:'GW2412G068',readTimeoutMs:150,connectTimeoutMs:150,requestGapMs:10,onTransportEvent:e=>events.push(e)});
 t.after(async()=>{c.close();for(const x of timers)clearTimeout(x);for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));});
 return {c,events,requests,sockets,timers,get connections(){return connections;},get heartbeats(){return heartbeats;}};
}
test('reuses one connection for sequential meter/topology reads and accepts coalesced/fragmented frames',async t=>{
 const x=await rig(t,(s,q)=>{const good=reply(q),wrong=reply(q,{slave:18}),crc=reply(q,{badCrc:true});s.write(Buffer.concat([wrong,crc,good.subarray(0,17)]));setTimeout(()=>{if(!s.destroyed)s.write(good.subarray(17));},5);});
 for(let i=0;i<4;i++){const r=await x.c.readInputRegisters(i%2?1700:1616,3);assert.equal(r.inverterSerial,'GW2412G068');assert(r.requestSentAtMs<=Date.now());}
 assert.equal(x.connections,1);assert(x.events.filter(e=>e.phase==='frame-rejected').length>=8);
});
test('echoes a Gateway heartbeat while idle without creating a read or taking a queue lease',async t=>{
 const x=await rig(t,(s,q)=>s.write(reply(q)));await x.c.readInputRegisters(1616,3);const raw=Buffer.alloc(19);raw.writeUInt16BE(0x5959,0);raw.writeUInt16BE(1,2);raw.writeUInt16BE(13,4);raw[6]=1;raw[7]=1;raw.write('AB1234G567',8,10,'ascii');raw[18]=1;
 [...x.sockets][0].write(raw);await new Promise(r=>setTimeout(r,30));assert.equal(x.heartbeats,1);assert.equal(x.requests.length,1);assert.equal(x.events.filter(e=>e.phase==='heartbeat-echoed').length,1);
});
test('retains the connection across two timeouts and recovers on a later read without renewing an ambiguous old request',async t=>{
 const x=await rig(t,(s,q,n)=>{if(n===3)s.write(reply(q));});await assert.rejects(x.c.readInputRegisters(1616,3),/timed out/);const next=Date.now();const r=await x.c.readInputRegisters(1616,3);assert.equal(x.connections,1);assert(r.requestSentAtMs<next,'a late same-bank reply must not be assigned a newer age');
});
test('a delayed first-attempt response during retry retains the first send timestamp',async t=>{
 let sentAt;const x=await rig(t,(s,q,n)=>{if(n===1){sentAt=Date.now();x.timers.push(setTimeout(()=>{if(!s.destroyed)s.write(reply(q));},180));}});const r=await x.c.readInputRegisters(1616,3);assert.equal(x.requests.length,2);assert(r.requestSentAtMs<=sentAt);assert(Date.now()-r.requestSentAtMs>=170);
});
test('remote disconnect reconnects within the bounded read recovery',async t=>{
 const x=await rig(t,(s,q,n)=>{if(n===1)s.destroy();else s.write(reply(q));});assert.equal((await x.c.readInputRegisters(1616,3)).values.length,3);assert.equal(x.connections,2);
});
test('wrong serial faults the feed immediately; it is not accepted or silently retried',async t=>{
 const x=await rig(t,(s,q)=>s.write(reply(q,{serial:'GW9999G999'})));const {GatewayFeed}=require('../lib/marstek/gateway-feed');const f=new GatewayFeed({serial:'GW2412G068'},{client:x.c});await assert.rejects(f.tick(),/identity\/range/);assert.equal(x.requests.length,1);assert.equal(f.identityFault,true);assert.throws(()=>f.snapshot(),/identity/);
});
test('mismatched function/range and unsolicited replies cannot satisfy another read',async t=>{
 const x=await rig(t,(s,q)=>{const bad=reply(q,{base:1800});s.write(Buffer.concat([bad,reply(q)]));});const r=await x.c.readInputRegisters(1616,3);assert.equal(r.baseRegister,1616);assert(x.events.some(e=>e.phase==='unmatched-response'));
});
test('read allowlist and absent write methods prevent accidental Gateway commands',async t=>{
 const x=await rig(t);for(const [b,n] of [[0,60],[1616,4],[1700,60]])await assert.rejects(x.c.readInputRegisters(b,n),/profile refused/);assert.equal(x.requests.length,0);assert.equal(x.c.writeRegister,undefined);assert.equal(x.c.readHoldingRegisters,undefined);
});
test('releases shared queue after each read; higher-priority AIO work wins before the next Gateway request',async t=>{
 const x=await rig(t,(s,q)=>s.write(reply(q))),broker=new Broker(),order=[];x.c.acquire=(host,opts)=>broker.acquire('site',opts);x.c.givLeaseOptions=()=>({priority:20,deadline:Date.now()+1000});
 await x.c.readInputRegisters(1616,3);const release=await broker.acquire('site');const next=x.c.readInputRegisters(1700,3);await new Promise(r=>setImmediate(r));const aio=broker.run('site',async()=>{order.push('aio');},{priority:100,deadline:Date.now()+1000});release();await aio;await next;order.push('gateway');assert.deepEqual(order,['aio','gateway']);assert.equal(x.connections,1);const free=await broker.acquire('site');free();
});
test('stop cancels queued and active work, closes the socket and permits a clean restart',async t=>{
 const x=await rig(t,(s,q,n)=>{if(n>1)s.write(reply(q));});const a=x.c.readInputRegisters(1616,3),b=x.c.readInputRegisters(1700,3);const settled=Promise.allSettled([a,b]);await new Promise(r=>setTimeout(r,25));x.c.close();const results=await settled;assert(results.every(r=>r.status==='rejected'));assert.equal(x.c.pending,null);assert.equal(x.c.socket,null);assert.equal((await x.c.readInputRegisters(1700,3)).values.length,3);
});
test('default pacing keeps consecutive sends at least 250ms apart',async t=>{
 const x=await rig(t,(s,q)=>s.write(reply(q)));x.c.requestGapMs=250;await x.c.readInputRegisters(1616,3);await x.c.readInputRegisters(1700,3);const sends=x.events.filter(e=>e.phase==='request-sent');assert(sends[1].requestSentAtMs-sends[0].requestSentAtMs>=245);
});
