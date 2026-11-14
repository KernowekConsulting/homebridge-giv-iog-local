'use strict';
const net=require('node:net');
const {ReadOnlyModbusTcpClient}=require('../lib/marstek/modbus-tcp');
const {readSnapshot}=require('../lib/marstek/venus-e3');
const signed=n=>n>32767?n-65536:n;
// TEST ONLY. Register facts: reference/e_v3.yaml. Timing, physics, readback and
// stop/watchdog behaviour are explicit model assumptions, never firmware claims.
class VenusSim {
 constructor({soc=60,watchdogMs=0,ignoreStop=false,dischargeLimitW=800,simulatedUplift=false,responseTauMs=3000,responseDelayMs=0}={}) {
  if(![800,2500].includes(dischargeLimitW)||(dischargeLimitW>800&&!simulatedUplift))throw Error('Explicit simulated uplift required');this.dischargeLimitW=dischargeLimitW;
  if(!Number.isFinite(responseTauMs)||responseTauMs<100||!Number.isInteger(responseDelayMs)||responseDelayMs<0||responseDelayMs>5000)throw Error('Invalid simulation timing');Object.assign(this,{responseTauMs,responseDelayMs});
  Object.assign(this,{soc,watchdogMs,ignoreStop});this.now=0;this.lastWrite=0;this.actual=0;this.demand=0;this.link=true;this.fault=null;this.commands=[];this.sockets=new Set();this.connectionsAccepted=0;
  this.reg=new Map([[42000,21947],[42010,0],[42011,100],[42020,0],[42021,0]]);
  this.server=net.createServer(s=>{this.connectionsAccepted++;this.sockets.add(s);s.on('close',()=>this.sockets.delete(s));s.on('error',()=>{});let b=Buffer.alloc(0);s.on('data',chunk=>{b=Buffer.concat([b,chunk]);while(b.length>=7){const len=b.readUInt16BE(4);if(len<2||len>254){s.destroy();return;}if(b.length<len+6)return;const q=b.subarray(0,len+6);b=b.subarray(len+6);this.handle(s,q);}});});
 }
 async start(){await new Promise((r,j)=>{this.server.once('error',j);this.server.listen(0,'127.0.0.1',r);});this.port=this.server.address().port;return this;}
 async close(){for(const s of this.sockets)s.destroy();await new Promise(r=>this.server.close(r));}
 tick(ms){
  this.now+=ms;if(this.watchdogMs&&this.now-this.lastWrite>this.watchdogMs)this.demand=0;
  if(this.demand>0&&this.soc<=this.reg.get(42011)||this.demand<0&&this.soc>=this.reg.get(42011))this.demand=0;
  const old=this.actual;this.actual+=(this.demand-this.actual)*(1-Math.exp(-ms/this.responseTauMs));
  const avg=(old+this.actual)/2;this.soc=Math.max(0,Math.min(100,this.soc+(avg<0?-avg*.92:-avg/.94)*ms/3600000/5120*100));
 }
 word(a){
  const name=Buffer.alloc(20);name.write('Venus E 3.0');if(a>=31000&&a<31010)return name.readUInt16BE((a-31000)*2);
  if(a>=30200&&a<30205)return 100;
  return new Map([[30001,Math.round(-this.actual)&65535],[30006,Math.round(this.actual)&65535],[34002,Math.round(this.soc*10)],[35000,220],[32200,2400]]).get(a)??this.reg.get(a);
 }
 valid(a,v){return a===42000?[21930,21947].includes(v):a===42010?v<=2:a===42011?(v>=10&&v<=100||v===0&&this.reg.get(42010)===0&&this.reg.get(42020)===0&&this.reg.get(42021)===0):a===42020?v<=2500&&v%50===0:a===42021?v<=this.dischargeLimitW&&v%50===0:false;}
 handle(s,q){
  if(!this.link){s.destroy();return;}const fn=q[7],a=q.readUInt16BE(8),n=q.readUInt16BE(10);let p,exception=0;
  if(q.readUInt16BE(2)!==0||q[6]!==1){s.destroy();return;}
  if(fn===3&&q.length===12&&n>=1&&n<=32){const vals=Array.from({length:n},(_,i)=>this.word(a+i));if(vals.some(v=>v===undefined))exception=2;else{p=Buffer.alloc(2+n*2);p[0]=3;p[1]=n*2;vals.forEach((v,i)=>p.writeUInt16BE(v,2+i*2));}}
  else if(fn===6&&q.length===12){if(!this.valid(a,n))exception=3;else if(this.fault==='reject-write'){this.fault=null;exception=4;}else{
   this.reg.set(a,n);this.lastWrite=this.now;this.commands.push({time:this.now,address:a,value:n});
   if(a===42010){if(n===0){if(!this.ignoreStop)this.demand=0;}else this.demand=this.reg.get(42000)===21930?(n===1?-this.reg.get(42020):this.reg.get(42021)):0;}
   p=Buffer.from(q.subarray(7));
  }}else exception=1;
  if(exception)p=Buffer.from([fn|128,exception]);
  if(this.fault==='silent'){this.fault=null;return;}
  if(this.fault==='drop-ack'&&fn===6&&!exception){this.fault=null;s.destroy();return;}
  const h=Buffer.from(q.subarray(0,7));h.writeUInt16BE(p.length+1,4);
  if(this.fault==='wrong-transaction'){this.fault=null;h.writeUInt16BE((h.readUInt16BE(0)+1)&65535,0);}
  if(this.fault==='wrong-unit'){this.fault=null;h[6]=2;}
  const response=Buffer.concat([h,p]);
  if(this.fault==='truncated'){this.fault=null;s.end(response.subarray(0,8));return;}
  if(this.fault==='fragment'){this.fault=null;s.write(response.subarray(0,5));setImmediate(()=>s.write(response.subarray(5)));return;}
  if(this.responseDelayMs){setTimeout(()=>{if(!s.destroyed)s.write(response);},this.responseDelayMs);return;}
  s.write(response);
 }
}
class LoopbackActuator {
 constructor({host='127.0.0.1',port,timeoutMs=100}={}){if(host!=='127.0.0.1'||!Number.isInteger(port)||port<1024||port>65535)throw Error('Simulator loopback only');if(!Number.isInteger(timeoutMs)||timeoutMs<50||timeoutMs>30000)throw Error('Invalid simulator client timeout');this.timeoutMs=timeoutMs;this.host=host;this.port=port;this.sequence=0;this.writeTail=Promise.resolve();this.writer=null;this.reader=new ReadOnlyModbusTcpClient({host,port,unitId:1,timeoutMs});}
 async write(a,v){const job=this.writeTail.then(()=>this.writeOne(a,v));this.writeTail=job.catch(()=>{});return job;}
 async writeOne(a,v){
  if(this.host!=='127.0.0.1')throw Error('Simulator loopback only');
  if(![42000,42010,42011,42020,42021].includes(a)||!Number.isInteger(v)||v<0||v>65535)throw Error('Write denied');
  const q=Buffer.alloc(12),id=++this.sequence&65535;q.writeUInt16BE(id);q.writeUInt16BE(6,4);q[6]=1;q[7]=6;q.writeUInt16BE(a,8);q.writeUInt16BE(v,10);
  return new Promise((resolve,reject)=>{
   const reused=this.writer&&!this.writer.destroyed,s=reused?this.writer:net.createConnection({host:this.host,port:this.port});let b=Buffer.alloc(0),done=false;
   const finish=e=>{if(done)return;done=true;s.setTimeout(0);s.removeAllListeners();s.on('error',()=>{});if(e){s.destroy();if(this.writer===s)this.writer=null;reject(e);}else{this.writer=s;resolve();}};
   const send=()=>{if(s.remoteAddress!=='127.0.0.1'||s.remotePort!==this.port)return finish(Error('Endpoint mismatch'));s.write(q);};
   s.on('error',finish);s.on('end',()=>finish(Error('Incomplete write response')));s.on('close',()=>finish(Error('Write connection closed')));s.setTimeout(this.timeoutMs,()=>finish(Error('Write timeout')));
   s.on('data',x=>{b=Buffer.concat([b,x]);if(b.length<7)return;const len=b.readUInt16BE(4);if(len<2||len>254)return finish(Error('Invalid MBAP length'));if(b.length<len+6)return;if(b.length!==len+6||b.readUInt16BE(0)!==id||b.readUInt16BE(2)!==0||b[6]!==1)return finish(Error('Invalid response envelope'));if(b[7]===134)return finish(Error('Modbus exception '+b[8]));if(!b.equals(q))return finish(Error('Write echo mismatch'));finish();});
   if(reused)send();else s.once('connect',send);
  });
 }

 async telemetry(now){const s=await readSnapshot(this.reader,{now:()=>now});return {observedAtMs:now,socPercent:s.model.socPercent,acDischargeW:s.model.acSignedW,acDirectionQualified:true};}
 async readControls(){return {mode:(await this.reader.readHoldingRegisters(42010,2))[0],power:await this.reader.readHoldingRegisters(42020,2)};}
 close(){this.reader.close();if(this.writer)this.writer.destroy();this.writer=null;}
}
module.exports={VenusSim,LoopbackActuator,signed};
