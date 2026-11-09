'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
class ActionAuthority{
 constructor(file,identity,{legacyIdentityMatch=()=>false}={}){this.file=file;this.identity=identity;this.state={schema:1,identity,generation:0,hold:null,completed:{}};
 try{const s=JSON.parse(fs.readFileSync(file));if(s.schema!==1||(s.identity!==identity&&!legacyIdentityMatch(s.identity,identity))||!Number.isSafeInteger(s.generation)||s.generation<0||!s.completed||typeof s.completed!=='object')throw Error('Invalid action authority');this.state={...s,identity,hold:s.active?'restart-recovery':s.hold,active:null};this.commit(this.state);}catch(e){if(e.code!=='ENOENT')throw e;}}
 commit(next){const text=JSON.stringify(next);if(Buffer.byteLength(text)>65536)throw Error('Authority capacity exceeded');const tmp=this.file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,text,{mode:0o600,flag:'wx'});fs.renameSync(tmp,this.file);this.state=next;}finally{try{fs.unlinkSync(tmp);}catch(e){if(e.code!=='ENOENT')throw e;}}}
 hold(reason){if(this.state.hold===reason&&!this.state.active)return;this.commit({...this.state,generation:this.state.generation+1,hold:reason,active:null});}
 begin(owner,now){if(!owner||!Number.isFinite(now))throw Error('Invalid owner');const token={id:crypto.randomUUID(),generation:this.state.generation+1,owner,startedAtMs:now};this.commit({...this.state,generation:token.generation,hold:null,active:token});return token;}
 allows(token){return !this.state.hold&&token?.id===this.state.active?.id&&token?.generation===this.state.generation;}
 complete(key,endAtMs,now){if(!key||!Number.isFinite(endAtMs)||endAtMs<=now)throw Error('Invalid occurrence');const completed=Object.fromEntries(Object.entries(this.state.completed).filter(([,end])=>Number.isFinite(end)&&end>now));completed[key]=endAtMs;if(Object.keys(completed).length>64)throw Error('Too many occurrence records');this.commit({...this.state,active:null,completed});}
 completed(key,now){return Number.isFinite(this.state.completed[key])&&this.state.completed[key]>now;}
 finish(){this.commit({...this.state,active:null});}
}
module.exports={ActionAuthority};
