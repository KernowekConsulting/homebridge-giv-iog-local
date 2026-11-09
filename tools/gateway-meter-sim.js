'use strict';
const fs = require('node:fs');
const { GatewayMeterController, SimulatedVenusActuator } = require('../lib/marstek/meter-controller');
function simulate({ mode = 'residual', ticks = 90, loadW = 1200, solarW = 0, aioEco = false, dropAt = Infinity, controllerOptions = {} } = {}) {
 const controller = new GatewayMeterController({ mode, ...controllerOptions }), actuator = new SimulatedVenusActuator(), rows = [];
 let aioW = 0, g, v;
 for (let i = 0; i < ticks; i++) {
  const nowMs=10000+i*1000, venusW=actuator.output(nowMs);
  if(aioEco) aioW=Math.max(-2500,Math.min(6000,loadW-solarW-venusW));
  const gridW=solarW+aioW+venusW-loadW;
  if(i<dropAt){g={observedAtMs:nowMs,gridExportW:gridW,aioDischargeW:aioW};v={observedAtMs:nowMs,socPercent:60,acDischargeW:venusW,acDirectionQualified:true};}
  const r=controller.step({gateway:g,venus:v,nowMs});actuator.accept(r);
  rows.push({second:i,gridExportW:gridW,aioDischargeW:aioW,venusDischargeW:venusW,requestedW:r.powerW,kind:r.kind,reason:r.reason});
 }
 return rows;
}
if(require.main===module){
 const cases={residualImport:{},residualSolar:{solarW:2000,loadW:500},aioEcoResidual:{aioEco:true},aioEcoHouseSupport:{aioEco:true,mode:'house-support'},telemetryLoss:{dropAt:20},higherCommissionedHouseSupport:{aioEco:true,mode:'house-support',controllerOptions:{maxDischargeW:2500,higherDischargeLimitConfirmed:true}}};
 if(process.argv[3]) {
  const config=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
  const options=require('../lib/marstek/integration-config').controllerOptionsFromConfig(config,process.argv[4]);
  for(const key of Object.keys(cases))delete cases[key];
  cases.savedConfiguration={aioEco:true,controllerOptions:options};
 }
 const report={simulationOnly:true,assumptions:'Ideal lossless AC response, 1 second steps; Eco AIO responds before each sample. No physical watchdog or export limiter qualified.',scenarios:{}};
 for(const [name,config] of Object.entries(cases))report.scenarios[name]=simulate(config);
 if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));else console.log(JSON.stringify(report,null,2));
}
module.exports={simulate};
