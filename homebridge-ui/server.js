'use strict';
const { testGateway } = require('../lib/marstek/gateway-diagnostics');
async function loadServerClass() {
  // SDK is ESM. Dynamic import also supports earlier Node 22 releases.
  const { HomebridgePluginUiServer, RequestError } = await import(require.resolve('@homebridge/plugin-ui-utils'));
  return class MarstekUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();this.busy=false;
    this.onRequest('/marstek/gateway-test',async payload=>{
      if(this.busy)throw new RequestError('Gateway test already running');this.busy=true;
      try{const fs=require('node:fs'),path=require('node:path');let cached;try{cached=JSON.parse(fs.readFileSync(path.join(this.homebridgeStoragePath,'givhome-marstek-gateway.json')));}catch{}if(cached?.host===payload.marstekGatewayHost&&cached.serial===String(payload.marstekGatewaySerial||'').toUpperCase()&&Date.now()-cached.observedAtMs<6000&&cached.observedAtMs<=Date.now())return {...cached,verified:true};const release=require('../lib/marstek/endpoint-ownership').claim([payload.marstekGatewayHost+':8899']);try{return await testGateway(payload);}finally{release();}}catch(error){throw new RequestError(error.message);}finally{this.busy=false;}
    });
    this.onRequest('/marstek/status',async()=>{const fs=require('node:fs'),path=require('node:path');let record;try{record=JSON.parse(fs.readFileSync(path.join(this.homebridgeStoragePath,'givhome-site-preview/status.json')));}catch{}if(record&&Date.now()-record.at<=10000&&record.at<=Date.now()&&typeof record.title==='string')return {title:record.title,detail:record.detail};return require('../lib/marstek/user-status').userStatus(null);});
    this.onRequest('/marstek/commissioning-status',async()=>{
      const {files,load}=require(require('../lib/marstek/build-profile').transport==='local-api'?'../lib/marstek/local-api-commissioning':'../lib/marstek/commissioning');const state=load(files(this.homebridgeStoragePath).status);
      if(!state||Date.now()-(state.heartbeatAt||0)>30000)return {title:'Save and restart first',detail:'Save your Marstek settings and restart Homebridge, then check the connections.',offline:true};
      return state;
    });
    this.onRequest('/marstek/commissioning',async payload=>{try{return require('./commissioning-request').enqueue(this.homebridgeStoragePath,payload?.action);}catch(error){throw new RequestError(error.message);}});
    this.ready();
  }
  };
}
if(require.main===module)loadServerClass().then(Server=>new Server()).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={loadServerClass};
