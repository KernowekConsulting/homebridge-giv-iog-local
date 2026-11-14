'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
async function harness(config){
 const element=()=>({hidden:false,attributes:{},setAttribute(k,v){this.attributes[k]=v;},appendChild(){},querySelectorAll:()=>[{},{}],querySelector:()=>({})});
 const ids=Object.fromEntries(['givhome-config-status','givhome-settings-tabs','givhome-main-tab','givhome-marstek-tab'].map(id=>[id,element()])),forms=[],updates=[],sections=[];let ready,native;
 const window={GivHomeMarstekSettings:{mount:(get,on)=>native={get,on,setVisible(){},valid:()=>true}},addEventListener(){},GivHomeCommissioning:{mount:()=>({setSectionActive:v=>sections.push(v),update(){}})}};
 const homebridge={addEventListener:(_e,f)=>ready=f,getPluginConfig:async()=>[structuredClone(config)],getPluginConfigSchema:async()=>structuredClone(require('../config.schema.json')),updatePluginConfig:async c=>updates.push(structuredClone(c)),createForm:(schema,data)=>{const form={schema,data:structuredClone(data),onChange(f){this.change=f;},end(){this.ended=true;}};forms.push(form);return form;},disableSaveButton(){},enableSaveButton(){},toast:{error:m=>{throw Error(m);}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../homebridge-ui/public/ui.js'),'utf8'),{window,document:{getElementById:id=>ids[id],createElement:element,body:{appendChild(){}}},homebridge,GivHomeConfigMigration:require('../homebridge-ui/public/config-migration'),setInterval:()=>1,clearInterval(){}});await ready();return {ids,forms,updates,sections,native};
}
test('Opening normal settings hides Marstek setup even with an installed Venus; tab changes do not save settings',async()=>{
 const h=await harness({platform:'GivHomeModbus',marstekIntegrationEnabled:true,marstekDevices:[{id:'v',host:'192.0.2.2'}]});
 assert.equal(h.forms.length,1);assert(!h.forms[0].schema.form.some(s=>s.title==='Marstek Integration'));assert.deepEqual(h.sections,[false]);const saves=h.updates.length;
 h.ids['givhome-marstek-tab'].onclick();assert(h.forms[0].ended);assert.equal(h.forms.length,1,'Marstek must not create another nested schema form');assert.equal(h.sections.at(-1),true);assert.equal(h.updates.length,saves);
 h.ids['givhome-main-tab'].onclick();assert.equal(h.sections.at(-1),false);assert.equal(h.ids['givhome-main-tab'].attributes['aria-pressed'],'true');assert.equal(h.updates.length,saves);
});
test('Editing across the two views preserves both configurations and unknown owner settings',async()=>{
 const h=await harness({platform:'GivHomeModbus',inverterSerial:'CH2344G083',targetSoc:80,marstekIntegrationEnabled:true,marstekDevices:[{id:'v',host:'192.0.2.2',maxChargeW:1000}],ownerSetting:{keep:true}});
 await h.forms[0].change({...h.forms[0].data,targetSoc:90});h.ids['givhome-marstek-tab'].onclick();assert.equal(h.native.get().targetSoc,90);
 await h.native.on({...h.native.get(),marstekDevices:[{id:'v',host:'192.0.2.2',maxChargeW:1100}]},{fromMarstek:true});h.ids['givhome-main-tab'].onclick();
 assert.equal(h.forms[1].data.targetSoc,90);assert.equal(h.forms[1].data.marstekDevices[0].maxChargeW,1100);assert.deepEqual(h.updates.at(-1)[0].ownerSetting,{keep:true});
});

test('Main form cannot erase hidden Venus addresses or permanent IDs',async()=>{const h=await harness({marstekIntegrationEnabled:true,marstekDevices:[{id:'permanent',host:'192.0.2.2',dischargeLimitW:2500}]});await h.forms[0].change({...h.forms[0].data,marstekDevices:[{name:'incomplete renderer value'}]});assert.equal(h.updates.at(-1)[0].marstekDevices[0].host,'192.0.2.2');assert.equal(h.updates.at(-1)[0].marstekDevices[0].id,'permanent');});
