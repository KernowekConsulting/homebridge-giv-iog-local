'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const schema=require('../config.schema.json');
const {gatewayOptionsFromConfig,controllerOptionsFromConfig}=require('../lib/marstek/integration-config');
const {readGatewayFromConfig}=require('../lib/marstek/gateway-meter');
const {GatewayMeterController}=require('../lib/marstek/meter-controller');
const {normaliseDevices}=require('../lib/marstek/venus-e3');
const {migrateExistingConfig}=require('../homebridge-ui/public/config-migration');
const {simulate}=require('./gateway-meter-sim');
const config=()=>({marstekGatewayHost:'192.168.0.103',marstekGatewaySerial:'GW2412G068',marstekDevices:[{id:'garage',host:'192.0.2.50'}]});
test('Marstek Integration is the final UI section and fields are exposed once',()=>{
 assert.equal(schema.form.at(-1).title,'Marstek Integration');
 const keys=[];function walk(nodes){for(const n of nodes){if(typeof n==='string')keys.push(n);else {if(n.key)keys.push(n.key);walk(n.items||[]);}}}walk(schema.form);
 for(const key of ['marstekGatewayHost','marstekGatewaySerial','marstekDevices','marstekControlEnabled','marstekAutomationHold'])assert.equal(keys.filter(k=>k===key).length,1);
 assert.equal(schema.schema.properties.marstekDevices.items.properties.maxDischargeW.default,800);
 for(const key of ['marstekControllerMode','marstekShadowEnabled','marstekSitePreviewEnabled'])assert.equal(keys.includes(key),false,'engineering preview setting must not clutter the UI');
 for(const key of ['marstekGatewayHost','marstekGatewaySerial'])assert.ok(!schema.schema.required.includes(key));
});
test('Gateway configuration is optional, paired and syntactically validated',()=>{
 assert.equal(gatewayOptionsFromConfig({}),null);
 assert.equal(gatewayOptionsFromConfig({...config(),marstekGatewaySerial:' gw2412g068 '}).serial,'GW2412G068');
 for(const change of [{marstekGatewayHost:''},{marstekGatewaySerial:''},{marstekGatewayHost:'https://192.168.0.103'},{marstekGatewaySerial:'CH2344G083'},{marstekGatewayHost:'192.168.0.999'}])assert.throws(()=>gatewayOptionsFromConfig({...config(),...change}));
});
test('expected Gateway serial is enforced on the actual read path',async()=>{
 let reads=0;const client={async readInputRegisters(base,count){reads++;return {inverterSerial:'GW00000000',deviceAddress:17,transparentFunction:4,baseRegister:base,values:Array(count).fill(0)};}};
 await assert.rejects(readGatewayFromConfig(config(),{client,now:()=>1}),/identity/);assert.equal(reads,1);
 await assert.rejects(readGatewayFromConfig({},{client,now:()=>1}),/not configured/);assert.equal(reads,1);
});
test('800 W is the default ceiling and higher ceilings require explicit existing-device confirmation',()=>{
 assert.equal(new GatewayMeterController().config.maxDischargeW,800);
 assert.equal(controllerOptionsFromConfig(config(),'garage').maxDischargeW,800);
 assert.throws(()=>new GatewayMeterController({maxDischargeW:2500}),/confirmation/);
 assert.throws(()=>normaliseDevices([{id:'g',host:'venus',maxDischargeW:2500}]),/confirmation/);
 const c=config();c.marstekDevices[0].maxDischargeW=2500;c.marstekDevices[0].higherDischargeLimitConfirmed=true;
 assert.equal(controllerOptionsFromConfig(c,'garage').maxDischargeW,2500);
 assert.equal(controllerOptionsFromConfig(config(),'garage').maxChargeW,2500,'output ceiling is separate from input power');
});
test('saved preview policy reaches the simulator without changing another battery or GivEnergy config',()=>{
 const c={...config(),marstekControllerMode:'house-support',marstekReserveSoc:35,targetSoc:75};
 const migrated=migrateExistingConfig(c).config;
 assert.equal(migrated.marstekGatewaySerial,c.marstekGatewaySerial);assert.equal(migrated.targetSoc,75);
 const opts=controllerOptionsFromConfig(migrated,'garage');assert.equal(opts.reserveSoc,35);
 const row=simulate({aioEco:true,controllerOptions:opts}).at(-1);assert.equal(row.venusDischargeW,800);assert.equal(row.aioDischargeW,400);
 assert.throws(()=>controllerOptionsFromConfig(c,'missing'));
});
test('higher-limit result is explicitly configured rather than a factory default assumption',()=>{
 const row=simulate({aioEco:true,mode:'house-support',controllerOptions:{maxDischargeW:2500,higherDischargeLimitConfirmed:true}}).at(-1);
 assert.equal(row.venusDischargeW,1163);assert.equal(row.aioDischargeW,37);
});
function uiHarness(){
 const fs=require('node:fs'),vm=require('node:vm');let ready,change,resolveRequest;
 const status={},buttons=[{},{}],reportStatus={},panel={setAttribute(){},appendChild(){},querySelectorAll:()=>buttons,querySelector:()=>reportStatus};
 const homebridge={addEventListener:(_name,fn)=>ready=fn,getPluginConfig:async()=>[{marstekGatewayHost:'127.0.0.1',marstekGatewaySerial:'GW2412G068'}],getPluginConfigSchema:async()=>schema,
  updatePluginConfig:async()=>{},createForm:()=>({onChange:fn=>change=fn}),request:()=>new Promise(resolve=>resolveRequest=resolve),disableSaveButton(){},enableSaveButton(){},toast:{error:assert.fail}};
 const document={getElementById:()=>status,createElement:()=>panel,body:{appendChild(){}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../homebridge-ui/public/ui.js'),'utf8'),{homebridge,document,GivHomeConfigMigration:{migrateExistingConfig},Date,Set,Object,Array,Blob,URL,setInterval:()=>1,clearInterval:()=>{}});
 return {ready:()=>ready(),edit:data=>change(data),buttons,reportStatus,resolve:value=>resolveRequest(value)};
}
test('editing Gateway identity during a pending UI check cannot display stale success',async()=>{
 const ui=uiHarness();await ui.ready();const pending=ui.buttons[0].onclick();await ui.edit({marstekGatewayHost:'127.0.0.2',marstekGatewaySerial:'GW00000000'});
 ui.resolve({verified:true,serial:'GW2412G068',observedAtMs:Date.now(),onlineCount:1,gridExportW:0});await pending;
 assert.equal(ui.buttons[1].disabled,true);assert.match(ui.reportStatus.textContent,/Settings changed/);
});
test('successful UI check enables the report and a subsequent edit invalidates it',async()=>{
 const ui=uiHarness();await ui.ready();const pending=ui.buttons[0].onclick();ui.resolve({verified:true,observedAtMs:Date.now(),onlineCount:1,gridExportW:-3000});await pending;
 assert.equal(ui.buttons[1].disabled,false);assert.match(ui.reportStatus.textContent,/serial verified/);
 await ui.edit({marstekGatewayHost:'127.0.0.2'});assert.equal(ui.buttons[1].disabled,true);
});
test('custom UI server loads the ESM SDK through the supported asynchronous loader',async()=>{
 const Server=await require('../homebridge-ui/server').loadServerClass();assert.equal(Server.name,'MarstekUiServer');assert.equal(typeof Server.prototype.constructor,'function');
});
