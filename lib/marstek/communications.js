'use strict';
// One process-wide Giv contention domain; Venus endpoints have independent lanes.
class Broker {
 constructor({limit=64,now=()=>Date.now()}={}){this.limit=limit;this.now=now;this.lanes=new Map();this.sequence=0;}
 acquire(domain,{priority=0,deadline=this.now()+6000,valid=()=>true}={}){
  let lane=this.lanes.get(domain);if(!lane){lane={active:false,queue:[]};this.lanes.set(domain,lane);}
  if(lane.queue.length>=this.limit)return Promise.reject(Error('Communications queue full'));
  return new Promise((resolve,reject)=>{const job={priority,deadline,valid,resolve,reject,id:++this.sequence};lane.queue.push(job);this.drain(lane);});
 }
 drain(lane){if(lane.active)return;lane.queue.sort((a,b)=>b.priority-a.priority||a.id-b.id);while(lane.queue.length){const j=lane.queue.shift();if(this.now()>=j.deadline||!j.valid()){j.reject(Error('Communications request expired or revoked'));continue;}lane.active=true;let done=false;j.resolve(()=>{if(done)return;done=true;lane.active=false;this.drain(lane);});return;}}
 async run(domain,fn,options){const release=await this.acquire(domain,options);try{return await fn();}finally{release();}}
}
const broker=new Broker();const givHosts=new Set();
function registerGiv(hosts){for(const h of hosts.filter(Boolean))givHosts.add(h);return()=>{for(const h of hosts.filter(Boolean))givHosts.delete(h);};}
async function leaseGiv(host,options){return givHosts.has(host)?broker.acquire('giv-site',options):()=>{};}
module.exports={Broker,broker,registerGiv,leaseGiv};
