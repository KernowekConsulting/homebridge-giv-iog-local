'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
function alive(pid){if(!Number.isInteger(pid)||pid<=0)return true;try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
// Cooperating collectors must not overlap. Only an owner proved absent may be
// reclaimed; permissions, malformed claims and concurrent recovery fail closed.
function claim(endpoints,{directory=os.tmpdir(),pid=process.pid,isAlive=alive}={}){
 const claims=[];const release=()=>{for(const c of claims.splice(0)){try{const s=JSON.parse(fs.readFileSync(c.file));if(s.token===c.token)fs.unlinkSync(c.file);}catch(e){if(e.code!=='ENOENT')throw e;}}};
 try{for(const endpoint of [...new Set(endpoints)].sort()){
  const file=path.join(directory,'givhome-endpoint-'+crypto.createHash('sha256').update(endpoint).digest('hex')+'.lock'),token=crypto.randomUUID();
  const occupied=()=>Error('Endpoint already claimed; stop the other GivHome collector or recover its stale claim: '+file);
  let fd;
  try{fd=fs.openSync(file,'wx',0o600);}catch(error){
   if(error.code!=='EEXIST')throw error;
   let before,owner;try{before=fs.readFileSync(file,'utf8');owner=JSON.parse(before);}catch{throw occupied();}
   if(owner.endpoint!==endpoint||typeof owner.token!=='string'||!owner.token||!Number.isInteger(owner.pid)||owner.pid<=0||isAlive(owner.pid))throw occupied();
   // Serialise reapers. A normal claimant may win the unlink/open gap; wx then
   // rejects us without removing or replacing its newly acquired claim.
   const guard=file+'.recovery';let guardFd;
   try{guardFd=fs.openSync(guard,'wx',0o600);}catch{throw occupied();}
   try{fs.writeFileSync(guardFd,JSON.stringify({pid,token}));if(fs.readFileSync(file,'utf8')!==before||isAlive(owner.pid))throw occupied();fs.unlinkSync(file);try{fd=fs.openSync(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw occupied();throw e;}}
   finally{fs.closeSync(guardFd);fs.unlinkSync(guard);}
  }
  claims.push({file,token});try{fs.writeFileSync(fd,JSON.stringify({pid,token,endpoint,startedAt:new Date().toISOString()}));}finally{fs.closeSync(fd);}
 }return release;}catch(error){release();throw error;}
}
module.exports={claim};
