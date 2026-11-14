'use strict';
const net=require('node:net');
// Shared by read/command clients for one endpoint; broker serialises transactions.
const sessions=new Map();
class Session {
 constructor(key,options){Object.assign(this,options);this.key=key;this.sequence=0;this.refs=0;this.socket=null;this.pending=null;}
 retain(){clearTimeout(this.idleTimer);this.refs++;return this;}
 release(){if(--this.refs===0){this.idleTimer=setTimeout(()=>{if(this.refs===0){this.fail(Error('Venus session idle'));sessions.delete(this.key);}},250);this.idleTimer.unref?.();}}
 fail(error){const socket=this.socket;this.socket=null;socket?.destroy();if(this.pending){const p=this.pending;this.pending=null;clearTimeout(p.timer);error.sent=p.sent;p.reject(error);}}
 exchange(fn,address,value,{valid,timeoutMs,owner}){
  return new Promise((resolve,reject)=>{
   if(!valid())return reject(Error('Venus request revoked'));
   const id=this.sequence=(this.sequence+1)&65535,q=Buffer.alloc(12);q.writeUInt16BE(id);q.writeUInt16BE(6,4);q[6]=this.unitId;q[7]=fn;q.writeUInt16BE(address,8);q.writeUInt16BE(value,10);
   const timer=setTimeout(()=>this.fail(Error('Venus request timed out')),timeoutMs);
   this.pending={resolve,reject,timer,q,fn,value,valid,owner,sent:false};this.buffer=Buffer.alloc(0);
   const send=()=>{const p=this.pending;if(!p)return;if(!p.valid())return this.fail(Error('Venus request revoked before send'));p.sent=true;this.socket.ref();this.socket.write(q,e=>{if(e)this.fail(e);});};
   if(this.socket&&!this.socket.destroyed)return send();
   const socket=this.socket=new net.Socket();socket.setNoDelay(true);
   socket.on('error',e=>{if(this.socket===socket)this.fail(e);});socket.on('end',()=>{if(this.socket===socket)this.fail(Error('Venus response incomplete'));});socket.on('close',()=>{if(this.socket===socket)this.fail(Error('Venus connection closed'));});
   socket.on('data',chunk=>{if(this.socket===socket)this.receive(chunk);});socket.connect({host:this.host,port:this.port},send);
  });
 }
 receive(chunk){const p=this.pending;if(!p)return this.fail(Error('Unexpected Venus response'));this.buffer=Buffer.concat([this.buffer,chunk]);const b=this.buffer;
  if(b.length>260)return this.fail(Error('Venus response oversized'));if(b.length<7)return;const n=b.readUInt16BE(4);
  if(b.readUInt16BE(0)!==p.q.readUInt16BE(0)||b.readUInt16BE(2)!==0||b[6]!==this.unitId||n<3||n>254)return this.fail(Error('Venus response identity mismatch'));
  if(b.length<n+6)return;if(b.length!==n+6)return this.fail(Error('Venus trailing frame'));if(b[7]===(p.fn|128))return this.fail(Error('Venus exception '+b[8]));if(b[7]!==p.fn)return this.fail(Error('Venus function mismatch'));
  let result;if(p.fn===6){if(!b.equals(p.q))return this.fail(Error('Venus write echo mismatch'));result={acknowledged:true};}else{if(n!==3+p.value*2||b[8]!==p.value*2)return this.fail(Error('Venus count mismatch'));result=Array.from({length:p.value},(_,i)=>b.readUInt16BE(9+2*i));}
  clearTimeout(p.timer);this.pending=null;this.buffer=Buffer.alloc(0);this.socket?.unref();p.resolve(result);
 }
}
function acquire(options){const key=options.host+':'+options.port+':'+options.unitId;let s=sessions.get(key);if(!s){s=new Session(key,options);sessions.set(key,s);}return s.retain();}
module.exports={acquire};
