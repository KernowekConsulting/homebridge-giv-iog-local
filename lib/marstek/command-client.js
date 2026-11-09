'use strict';
const net=require('node:net');
const {broker}=require('./communications');
const WRITE_REGISTERS=new Set([42000,42010,42011,42020,42021]);
class CommandClient {
 constructor({host,port=502,unitId=1,timeoutMs=1500}={}){
  if(typeof host!=='string'||!host||!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(unitId)||unitId<1||unitId>247||!Number.isInteger(timeoutMs)||timeoutMs<50||timeoutMs>10000)throw Error('Invalid Venus connection');
  Object.assign(this,{host,port,unitId,timeoutMs});this.sequence=0;this.closed=false;this.sockets=new Set();
 }
 readHoldingRegisters(address,count){if(!Number.isInteger(address)||address<0||!Number.isInteger(count)||count<1||count>32||address+count>65536)return Promise.reject(Error('Invalid Venus read range'));return this.request(3,address,count);}
 write(address,value,{valid=()=>false,priority=10}={}){
  if(!WRITE_REGISTERS.has(address)||!Number.isInteger(value)||value<0||value>65535)return Promise.reject(Error('Venus write denied'));
  if(address===42000&&value!==21930&&value!==21947||address===42010&&value>2||address===42011&&(value<10||value>100)||[42020,42021].includes(address)&&(value>2500||value%50))return Promise.reject(Error('Venus value denied'));
  return this.request(6,address,value,{valid,priority});
 }
 request(fn,address,value,{valid=()=>true,priority=0}={}){
  return broker.run('venus:'+this.host+':'+this.port,()=>new Promise((resolve,reject)=>{
   if(this.closed||!valid())return reject(Error('Venus request revoked'));
   const id=this.sequence=(this.sequence+1)&65535,q=Buffer.alloc(12);q.writeUInt16BE(id);q.writeUInt16BE(6,4);q[6]=this.unitId;q[7]=fn;q.writeUInt16BE(address,8);q.writeUInt16BE(value,10);
   const s=new net.Socket();this.sockets.add(s);let b=Buffer.alloc(0),done=false,sent=false;
   const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);s.destroy();this.sockets.delete(s);if(error){error.sent=sent;reject(error);}else resolve(result);};
   const timer=setTimeout(()=>finish(Error('Venus request timed out')),this.timeoutMs);
   s.on('error',finish);s.on('end',()=>finish(Error('Venus response incomplete')));s.on('close',()=>finish(Error('Venus connection closed')));
   s.on('data',chunk=>{b=Buffer.concat([b,chunk]);if(b.length>260)return finish(Error('Venus response oversized'));if(b.length<7)return;const n=b.readUInt16BE(4);if(b.readUInt16BE(0)!==id||b.readUInt16BE(2)!==0||b[6]!==this.unitId||n<3||n>254)return finish(Error('Venus response identity mismatch'));if(b.length<n+6)return;if(b.length!==n+6)return finish(Error('Venus trailing frame'));if(b[7]===(fn|128))return finish(Error('Venus exception '+b[8]));if(b[7]!==fn)return finish(Error('Venus function mismatch'));if(fn===6){if(!b.equals(q))return finish(Error('Venus write echo mismatch'));return finish(null,{acknowledged:true});}if(n!==3+value*2||b[8]!==value*2)return finish(Error('Venus count mismatch'));finish(null,Array.from({length:value},(_,i)=>b.readUInt16BE(9+2*i)));});
   s.connect({host:this.host,port:this.port},()=>{if(this.closed||!valid())return finish(Error('Venus request revoked before send'));sent=true;s.write(q);});
  }),{priority,valid:()=>!this.closed&&valid(),deadline:Date.now()+this.timeoutMs+3000});
 }
 close(){this.closed=true;for(const s of this.sockets)s.destroy();}
}
module.exports={CommandClient};
