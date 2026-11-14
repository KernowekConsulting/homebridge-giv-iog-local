'use strict';
const {acquire}=require('./persistent-session');
const {broker}=require('./communications');
const WRITE_REGISTERS=new Set([42000,42010,42011,42020,42021]);
class CommandClient {
 constructor({host,port=502,unitId=1,timeoutMs=1500}={}){
  if(typeof host!=='string'||!host||!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(unitId)||unitId<1||unitId>247||!Number.isInteger(timeoutMs)||timeoutMs<50||timeoutMs>10000)throw Error('Invalid Venus connection');
  Object.assign(this,{host,port,unitId,timeoutMs});this.sequence=0;this.closed=false;this.session=acquire({host,port,unitId});
 }
 readHoldingRegisters(address,count){if(!Number.isInteger(address)||address<0||!Number.isInteger(count)||count<1||count>32||address+count>65536)return Promise.reject(Error('Invalid Venus read range'));return this.request(3,address,count);}
 write(address,value,{valid=()=>false,priority=10}={}){
  if(!WRITE_REGISTERS.has(address)||!Number.isInteger(value)||value<0||value>65535)return Promise.reject(Error('Venus write denied'));
  if(address===42000&&value!==21930&&value!==21947||address===42010&&value>2||address===42011&&(value<10||value>100)||[42020,42021].includes(address)&&(value>2500||value%50))return Promise.reject(Error('Venus value denied'));
  return this.request(6,address,value,{valid,priority});
 }
 async restoreIdleDefaultTarget({valid=()=>false}={}){
  if(!valid())throw Error('Venus restoration revoked');
  const mode=await this.readHoldingRegisters(42010,1),power=await this.readHoldingRegisters(42020,2);
  if(mode[0]!==0||power.some(v=>v!==0))throw Error('Idle Venus required to restore default target');
  return this.request(6,42011,0,{valid,priority:100});
 }
 request(fn,address,value,{valid=()=>true,priority=0}={}){
  return broker.run('venus:'+this.host+':'+this.port,()=>{
   if(this.closed||!valid())throw Error('Venus request revoked');
   return this.session.exchange(fn,address,value,{valid:()=>!this.closed&&valid(),timeoutMs:this.timeoutMs,owner:this});
  },{priority,valid:()=>!this.closed&&valid(),deadline:Date.now()+this.timeoutMs+3000});
 }
 close(){if(this.closed)return;this.closed=true;if(this.session.pending?.owner===this)this.session.fail(Error('Venus client closed'));this.session.release();}
}
module.exports={CommandClient};
