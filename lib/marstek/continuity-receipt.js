'use strict';
const fs=require('node:fs');
class ContinuityReceipt{
 constructor(file,identity){Object.assign(this,{file,identity});this.events=[];try{const old=JSON.parse(fs.readFileSync(file));if(old.schema===1&&old.identity===identity&&Array.isArray(old.events))this.events=old.events.slice(-63);}catch(error){if(error.code!=='ENOENT')this.previousReadError=error.message;}}
 record(event){this.events=[...this.events,event].slice(-64);const value={schema:1,identity:this.identity,latest:event,events:this.events};const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600});fs.renameSync(tmp,this.file);}
}
module.exports={ContinuityReceipt};
