'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
// Advisory ownership for cooperating GivHome processes. Other software can ignore it.
// Stale claims are held for explicit recovery rather than deleting a possibly live lock.
function claim(endpoints,{directory=os.tmpdir(),pid=process.pid}={}){
 const claims=[];const release=()=>{for(const c of claims.splice(0)){try{const s=JSON.parse(fs.readFileSync(c.file));if(s.token===c.token)fs.unlinkSync(c.file);}catch(e){if(e.code!=='ENOENT')throw e;}}};
 try{for(const endpoint of [...new Set(endpoints)].sort()){
  const file=path.join(directory,'givhome-endpoint-'+crypto.createHash('sha256').update(endpoint).digest('hex')+'.lock'),token=crypto.randomUUID();
  let fd;try{fd=fs.openSync(file,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error('Endpoint already claimed; stop the other GivHome collector or recover its stale claim: '+file);throw error;}
  claims.push({file,token});try{fs.writeFileSync(fd,JSON.stringify({pid,token,endpoint,startedAt:new Date().toISOString()}));}finally{fs.closeSync(fd);}
 }return release;}catch(error){release();throw error;}
}
module.exports={claim};
