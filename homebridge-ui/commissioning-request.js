'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {files,load,save,signature}=require('../lib/marstek/commissioning');
function enqueue(storage,action,now=Date.now()){
 if(!['check','commission','cancel'].includes(action))throw Error('Unknown setup action');
 const config=JSON.parse(fs.readFileSync(path.join(storage,'config.json'))).platforms?.find(p=>p.platform==='GivHomeModbus');
 if(!config||config.marstekIntegrationEnabled!==true)throw Error('Enable Marstek, save and restart first.');
 const paths=files(storage),state=load(paths.status),sig=signature(config);
 if(action!=='cancel'&&(!state||now-(state.heartbeatAt||0)>30000||(state.heartbeatAt||0)>now||state.signature!==sig))throw Error('Save your settings and restart Homebridge before running the check.');
 if(action!=='cancel'&&state.busy)throw Error('A battery check is already running.');
 const request={id:crypto.randomUUID(),action,signature:sig,at:now};save(paths.request,request);return {queued:true};
}
module.exports={enqueue};
