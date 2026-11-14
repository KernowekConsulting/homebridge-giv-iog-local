'use strict';
const dgram=require('node:dgram'),net=require('node:net');
const {broker}=require('./communications');
const sessions=new Map(),READS=new Set(['Marstek.GetDevice','ES.GetMode','ES.GetStatus']);
class ApiSession{
 constructor({host,port,quietMs,timeoutMs,localPort}){Object.assign(this,{host,port,quietMs,timeoutMs});this.refs=0;this.sequence=0;this.lastActivity=0;this.expectedSrc=null;this.pending=null;this.socket=dgram.createSocket('udp4');if(localPort)this.socket.bind(localPort);this.socket.on('error',error=>this.fail(error));this.socket.on('message',(data,peer)=>this.receive(data,peer));this.socket.unref();}
 fail(error){const p=this.pending;if(!p)return;this.pending=null;clearTimeout(p.timer);error.sent=p.sent;p.reject(error);}
 receive(data,peer){const p=this.pending;if(!p||peer.address!==this.host||peer.port!==this.port||data.length>16384)return;let r;try{r=JSON.parse(data.toString('utf8'));}catch{return;}if(!r||!Number.isInteger(r.id)||r.id!==p.id)return;
  this.lastActivity=Date.now();
  if(r.error){const error=Error('Venus Local API error '+r.error.code);error.apiCode=r.error.code;return this.fail(error);}
  if(typeof r.src!=='string'||!r.src||!r.result||typeof r.result!=='object'||Array.isArray(r.result))return this.fail(Error('Invalid Venus Local API response'));
  if(this.expectedSrc&&r.src!==this.expectedSrc)return this.fail(Error('Venus Local API identity changed'));
  if(p.method==='Marstek.GetDevice')this.expectedSrc=r.src;
  this.pending=null;clearTimeout(p.timer);p.resolve({src:r.src,result:r.result,receivedAtMs:Date.now(),sentAtMs:p.sentAtMs});
 }
 async exchange(method,params,{valid,timeoutMs,expiresAtMs,timed=false}){
  const delay=Math.max(0,this.lastActivity+this.quietMs-Date.now());if(delay)await new Promise(r=>setTimeout(r,delay));
  if(!valid()||expiresAtMs&&Date.now()>=expiresAtMs)throw Error('Venus Local API request revoked before send');
  const values=typeof params==='function'?params():params;
  if(method==='ES.SetMode'){
   const c=values?.config;if(c?.mode!=='Passive'||!Number.isInteger(c.passive_cfg?.power)||Math.abs(c.passive_cfg.power)>2500||!Number.isInteger(c.passive_cfg?.cd_time)||c.passive_cfg.cd_time<1||c.passive_cfg.cd_time>(timed?300:5))throw Error('Venus Local API write denied');
  }
  const id=(this.sequence=this.sequence%65535+1),payload=Buffer.from(JSON.stringify({id,method,params:values}));
  if(payload.length>2048)throw Error('Venus Local API request too large');
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{const e=Error('Venus Local API request timed out');e.code='ETIMEDOUT';this.fail(e);},timeoutMs);this.pending={id,method,resolve,reject,timer,sent:false};this.socket.ref();this.lastActivity=Date.now();this.pending.sent=true;this.pending.sentAtMs=Date.now();this.socket.send(payload,this.port,this.host,error=>{if(error)this.fail(error);});}).finally(()=>this.socket.unref());
 }
 close(){this.fail(Error('Venus Local API client closed'));this.socket.close();}
}
class LocalApiClient{
 constructor({host,port=30000,timeoutMs=1500,quietMs=2000,localPort}={}){
  if(net.isIP(host)!==4||!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(timeoutMs)||timeoutMs<50||timeoutMs>10000||!Number.isInteger(quietMs)||quietMs<0||quietMs>10000)throw Error('Invalid Venus Local API endpoint');
  this.key=host+':'+port;this.closed=false;this.timeoutMs=timeoutMs;let session=sessions.get(this.key);if(!session){session=new ApiSession({host,port,quietMs,timeoutMs,localPort});sessions.set(this.key,session);}else if(session.quietMs!==quietMs)throw Error('Venus Local API pacing conflict');this.session=session;session.refs++;
 }
 request(method,params={id:0},{valid=()=>true,priority=0,expiresAtMs,timed=false,timeoutMs}={}){
  if(!READS.has(method)&&method!=='ES.SetMode')return Promise.reject(Error('Venus Local API method denied'));
  if(method==='ES.SetMode'&&typeof arguments[2]?.valid!=='function')return Promise.reject(Error('Venus Local API write requires authority'));
  const allowed=()=>!this.closed&&valid()&&(!expiresAtMs||Date.now()<expiresAtMs);
  return broker.run('venus-api:'+this.key,()=>this.session.exchange(method,params,{valid:allowed,timeoutMs:timed?15000:(timeoutMs??this.timeoutMs),expiresAtMs,timed}),{priority,valid:allowed,deadline:expiresAtMs||Date.now()+Math.max(10000,(timeoutMs??this.timeoutMs)+this.session.quietMs+5000)});
 }
 getDevice(options){return this.request('Marstek.GetDevice',{ble_mac:'0'},options);}
 getMode(options){return this.request('ES.GetMode',{id:0},options);}
 getStatus(options){return this.request('ES.GetStatus',{id:0},options);}
 setPower(power,{valid=()=>false,expiresAtMs,countdownS,priority=10}={}){
  return this.request('ES.SetMode',()=>{const remaining=countdownS??Math.min(5,Math.floor((expiresAtMs-Date.now())/1000));return {id:0,config:{mode:'Passive',passive_cfg:{power,cd_time:remaining}}};},{valid,expiresAtMs,priority});
 }
 setTimedPower(power,{endAtMs,valid}={}){if(typeof valid!=='function'||!Number.isFinite(endAtMs)||endAtMs-Date.now()>300000)return Promise.reject(Error('Timed authority required'));return this.request('ES.SetMode',()=>({id:0,config:{mode:'Passive',passive_cfg:{power,cd_time:Math.floor((endAtMs-Date.now())/1000)}}}),{valid,expiresAtMs:endAtMs,timed:true,priority:power===0?100:10});}
 close(){if(this.closed)return;this.closed=true;if(--this.session.refs===0){sessions.delete(this.key);this.session.close();}}
}
module.exports={LocalApiClient};
