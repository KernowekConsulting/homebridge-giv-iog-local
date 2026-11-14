'use strict';
function socValue(entry,state,now=entry.monitor?.now?.()??Date.now()){
 const model=state.sample?.model;
 if(/identity|Unqualified Venus/i.test(state.lastError||'')||model&&model.observedAtMs>now){entry.socDisplay.clear();return null;}
 if(model)entry.socDisplay.remember(model.socPercent,model.observedAtMs,now);
 return entry.socDisplay.value(now);
}
function bind(manager,entry){const {api}=manager,{Service:S,Characteristic:C}=api.hap,a=entry.accessory,label=entry.device.name+' SOC';a.displayName=label;entry.socDisplay=new (require('./homekit-continuity').SocContinuity)();
 a.getService(S.AccessoryInformation).setCharacteristic(C.Name,label).setCharacteristic(C.Manufacturer,'Marstek').setCharacteristic(C.Model,'Venus E 3.0 — Local API').setCharacteristic(C.SerialNumber,'configured-'+entry.device.id);
 for(const old of [...a.services])if([S.TemperatureSensor.UUID,S.MotionSensor.UUID,(S.Battery||S.BatteryService).UUID,'D7AF3200-75F8-4E32-A720-EE89ED1B7101'].includes(old.UUID.toUpperCase()))a.removeService(old);
 a.category=api.hap.Categories?.LIGHTBULB??a.category;
 const service=(Type,name,subtype)=>a.getServiceById(Type,subtype)||a.addService(Type,name,subtype);
 const level=service(S.Lightbulb,label,'battery-level');level.setCharacteristic(C.Name,label);level.setPrimaryService(true);
 const P=api.hap.Perms||C.Perms;
 const read=getter=>{const state=entry.monitor.state();if(state.stale||!state.sample)throw new api.hap.HapStatusError(api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);return getter(state.sample.model);};
 const add=(s,c,getter,isSoc=false)=>{const value=s.getCharacteristic(c),displayTile=s.UUID===S.Lightbulb.UUID;value.setProps({perms:displayTile?[P.PAIRED_READ,P.PAIRED_WRITE,P.NOTIFY]:[P.PAIRED_READ,P.NOTIFY]});value.onGet(()=>{if(!isSoc)return read(getter);const v=socValue(entry,entry.monitor.state());if(v===null)throw new api.hap.HapStatusError(api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);return c.UUID===C.On.UUID?true:v;});if(displayTile)value.onSet(async()=>{});return [value,getter,isSoc];};
 entry.values=[add(level,C.On,()=>true,true),add(level,C.Brightness,m=>Math.round(m.socPercent),true)];entry.faults=[];
 entry.related=[];
 for(const role of ['charging','discharging']){
  const name=entry.device.name+' '+(role==='charging'?'Charging':'Discharging'),uuid=api.hap.uuid.generate('homebridge-giv-iog-local:marstek-venus-e3-mvp-v1:'+entry.device.id.toLowerCase()+':'+role),cached=manager.cached.get(uuid),status=cached||new api.platformAccessory(name,uuid,api.hap.Categories?.LIGHTBULB);
  status.context.marstekOwner=a.context.marstekOwner;status.context.batteryId=entry.device.id;status.context.marstekRole=role;status.displayName=name;
  status.getService(S.AccessoryInformation).setCharacteristic(C.Name,name).setCharacteristic(C.Manufacturer,'Marstek').setCharacteristic(C.Model,'Venus E 3.0 — '+role).setCharacteristic(C.SerialNumber,'configured-'+entry.device.id+'-'+role);
  const indicator=status.getServiceById(S.Lightbulb,role)||status.addService(S.Lightbulb,name,role);indicator.setPrimaryService(true);indicator.setCharacteristic(C.Name,name);entry.values.push(add(indicator,C.On,m=>m[role]));entry.related.push({accessory:status,cached:Boolean(cached)});
 }
 const telemetry=level; // Optional numeric power belongs to the SOC tile, not another grouped service.
 for(const [name,uuid,key]of [['Charge Power','D7AF3201-75F8-4E32-A720-EE89ED1B7101','chargePowerW'],['Discharge Power','D7AF3202-75F8-4E32-A720-EE89ED1B7101','dischargePowerW']]){let c=telemetry.characteristics.find(x=>x.UUID===uuid);if(!c){c=new C(name,uuid,{format:api.hap.Formats.UINT16,minValue:0,maxValue:10000,unit:'W',perms:[P.PAIRED_READ,P.NOTIFY]});telemetry.addCharacteristic(c);}c.onGet(()=>read(m=>m[key]));entry.values.push([c,m=>m[key]]);}

}
function publish(manager,entry,state){const notify=require('./homekit-continuity').publish;const {HapStatusError,HAPStatus,Characteristic:C,Service:S}=manager.api.hap;const cached=socValue(entry,state);for(const [characteristic,getter,isSoc]of entry.values)notify(characteristic,isSoc?(cached===null?new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE):characteristic.UUID===C.On.UUID?true:cached):state.stale||!state.sample?new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE):getter(state.sample.model));for(const f of entry.faults)f.updateValue(state.stale?1:0);if(state.sample)for(const a of [entry.accessory,...(entry.related||[]).map(r=>r.accessory)])a.getService(S.AccessoryInformation).updateCharacteristic(C.FirmwareRevision,state.sample.model.firmware.display);}
module.exports={bind,publish,socValue};
