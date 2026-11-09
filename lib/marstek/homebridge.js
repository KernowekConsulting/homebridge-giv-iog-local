'use strict';
const { normaliseDevices } = require('./venus-e3');
const { gatewayOptionsFromConfig } = require('./integration-config');
const fs = require('node:fs');
const path = require('node:path');
const { ShadowService } = require('./shadow-service');
const { ShadowJournal } = require('./shadow-journal');
const { readGateway } = require('./gateway-meter');
const { controllerOptionsFromConfig } = require('./integration-config');
const { VenusMonitor } = require('./monitor');
const {ControlSession,qualifiedBinding}=require('./control-session');
const PLUGIN = 'homebridge-giv-iog-local';
const PLATFORM = 'GivHomeModbus';
const OWNER = 'marstek-venus-e3-mvp-v1';

class MarstekHomebridge {
  constructor(log, api, config, { monitorFactory = device => new VenusMonitor(device), contextProvider = () => ({}), onSample = () => {}, onUnavailable = () => {}, isPlanValid=()=>true,gatewayReader=readGateway,claimEndpoints=require('./endpoint-ownership').claim,onCommissioning=async()=>{},onCommissioned=()=>{},fixtureQualified=qualifiedBinding,onControlFault=async()=>{} } = {}) {
    Object.assign(this, { log, api, config, monitorFactory, contextProvider, onSample, onUnavailable, isPlanValid,gatewayReader,claimEndpoints,onCommissioning,onCommissioned,fixtureQualified,onControlFault });
    this.cached = new Map(); this.entries = new Map(); this.started = false; this.timer = null;
  }
  owns(accessory) { return accessory.context?.marstekOwner === OWNER; }
  configureAccessory(accessory) { this.cached.set(accessory.UUID, accessory); }
  start() {
    if (this.started) return;
    let devices;
    try { devices = normaliseDevices(this.config.marstekDevices); }
    catch (error) {
      this.log.error('[Marstek] Configuration rejected: %s. Cached accessories retained as unavailable.', error.message);
      for (const accessory of this.cached.values()) this.faultAccessory(accessory);
      return;
    }
    try { this.gatewayOptions = gatewayOptionsFromConfig(this.config); }
    catch (error) { this.gatewayOptions = null; this.log.warn('[Marstek] Gateway configuration unavailable: %s. Battery monitoring is independent.', error.message); }
    if(devices.length && this.config.marstekIntegrationEnabled === true) {
      try { this.releaseOwnership=this.claimEndpoints([...devices.map(d=>d.host+':'+d.port),...([this.config.inverterHost,this.gatewayOptions?.host].filter(Boolean).map(h=>h+':8899'))]); }
      catch(error){this.log.error('[Marstek] %s',error.message);for(const a of this.cached.values())this.faultAccessory(a);return;}
    }
    this.started = true;
    if (this.config.marstekShadowEnabled === true && !devices.some(device => device.id === this.config.marstekShadowBatteryId)) {
      this.log.error('[Marstek Shadow] Not started: select the permanent ID of an enabled Venus battery.');
    }
    const expected = new Set();
    for (const device of devices) {
      const uuid = this.api.hap.uuid.generate(`${PLUGIN}:${OWNER}:${device.id.toLowerCase()}`);
      expected.add(uuid);
      const cached = this.cached.get(uuid);
      const accessory = cached || new this.api.platformAccessory(device.name, uuid);
      accessory.context.marstekOwner = OWNER;
      accessory.context.batteryId = device.id;
      // A configured ID gives stable HomeKit identity, not verified physical-device identity.
      accessory.context.hardwareQualified = false;
      accessory.displayName = device.name;
      const monitor = this.config.marstekControlEnabled===true ? new VenusMonitor(device,{clientFactory:options=>new (require('./command-client').CommandClient)(options)}) : this.monitorFactory(device);
      const entry = { device, accessory, monitor };
      this.entries.set(device.id, entry);
      this.bind(entry);
      monitor.on('state', state => {
        this.publish(entry, state);
        if (state.lastError) this.log.warn('[Marstek] %s: %s (%s); last observation retained.', device.name, state.lastError, state.status);
      });
      if (cached) this.api.updatePlatformAccessories?.([accessory]);
      else this.api.registerPlatformAccessories(PLUGIN, PLATFORM, [accessory]);
      this.cached.set(uuid, accessory);
      this.publish(entry, monitor.state());
      const selected = this.config.marstekShadowEnabled === true && this.config.marstekShadowBatteryId === device.id;
      if (selected) {
        try {
          if (!this.gatewayOptions) throw new Error('Gateway IP and expected serial are required');
          const directory = path.join(this.api.user.storagePath(), 'givhome-marstek-shadow');
          fs.mkdirSync(directory, { recursive: true });
          const identity = `${this.gatewayOptions.serial}:${device.id}:${device.host}:${device.port}:${device.unitId}`;
          const journal = new ShadowJournal(path.join(directory, `${device.id}.json`), identity);
          const options = controllerOptionsFromConfig(this.config, device.id);
          if(this.config.marstekControlEnabled === true) {
            const persistence=require('./commissioning'),controlFile=path.join(this.api.user.storagePath(),'givhome-venus-control.json'),sig=persistence.signature(this.config);
            this.controlSession=new ControlSession(device,{qualified:this.fixtureQualified(device),checkpoint:value=>persistence.save(controlFile,value?{...value,signature:sig}:null)});
            const interrupted=persistence.load(controlFile);if(interrupted?.active&&interrupted.signature===sig){this.controlSession.uncertain=true;this.controlSession.status='restart-reconciliation';}
          }
          this.commissioning = new (require('./commissioning').Commissioning)(this.config,this.api.user.storagePath(),{readGateway:()=>this.gatewayReader(this.gatewayOptions),before:async action=>{this.shadow?.stop();await this.shadow?.inFlight;if(action==='check'){if(this.controlSession?.command||this.controlSession?.uncertain)throw Error('Pause the active GivHome battery action before checking connections.');return;}await this.onCommissioning();await this.controlSession?.revoke();if(this.controlSession)this.controlSession.qualified=false;},after:success=>{if(success&&this.controlSession){this.controlSession.externalHeld=false;this.controlSession.command=0;this.controlSession.activeAttempt=false;this.controlSession.uncertain=false;this.controlSession.checkpoint(null);}this.onCommissioned(success);if(this.started)this.shadow?.start();}});
          this.shadow = new ShadowService({ options, journal, periodMs: device.pollIntervalSeconds * 1000,
            contextProvider: this.contextProvider,
            onUnavailable:()=>{this.onUnavailable();if(this.controlSession) void this.controlSession.revoke();},
            planProvider:this.config.marstekSitePreviewEnabled?async sample=>{const passiveFile=path.join(this.api.user.storagePath(),'givhome-marstek-gateway.json');fs.writeFileSync(passiveFile+'.tmp',JSON.stringify({host:this.gatewayOptions.host,...sample.gateway}),{mode:0o600});fs.renameSync(passiveFile+'.tmp',passiveFile);const plan=await this.onSample(sample);if(this.controlSession){const outcome=await this.controlSession.apply(plan,{...sample,tokenValid:()=>this.isPlanValid(plan)});if(['external-control-owner','stop-unconfirmed'].includes(outcome.status)){this.commissioning.status('Check needed',outcome.status==='external-control-owner'?'Another controller changed the Venus settings. Pause it in the app, then run the checks again.':'Battery stopping could not be confirmed. Check its connection and app before continuing.');await this.onControlFault(outcome.status);}}return plan;}:null,
            readGateway: () => this.gatewayReader(this.gatewayOptions),
            readVenus: async () => {
              await monitor.pollOnce(); const state = monitor.state();
              if (!state.sample || state.stale || state.failures) throw new Error('Fresh Venus sample unavailable');
              const m = state.sample.model;let certificate=null;const checkClient=new (require('./command-client').CommandClient)(device);try{certificate=await this.commissioning.qualification(checkClient,m);}catch(error){if(this.controlSession){this.controlSession.qualified=false;this.controlSession.generation++;}throw error;}finally{checkClient.close();}
              const loopback=this.fixtureQualified(device);this.commissioned=Boolean(certificate);if(!certificate&&require('./commissioning').load(this.commissioning.paths.certificate)){this.commissioning.ready=false;this.commissioning.status('Check needed','Battery, firmware or settings changed. Run the connection and battery checks again.');}if(this.controlSession){if(!certificate&&!loopback){this.controlSession.qualified=false;this.controlSession.generation++;}else this.controlSession.qualified=true;}
              const sign = certificate?.acDischargeSign || this.config.marstekAcDischargeSign;
              return { observedAtMs: m.observedAtMs, socPercent: m.socPercent,
                acDischargeW: sign === 'negative' ? -m.acSignedW : m.acSignedW,
                acDirectionQualified: sign === 'positive' || sign === 'negative' };
            } });
          
          this.shadow.on('decision', record => {
            this.shadowStatus = record;
            const signature = `${record.request.reason}:${record.request.source || ''}:${record.request.targetSoc ?? ''}`;
            if (signature !== this.shadowSignature) { this.shadowSignature = signature; this.log.info('[Marstek Shadow] %s: proposed %s W (%s). No device writes.', device.name, record.request.powerW, record.request.reason); }
          });
          this.shadow.start();
          this.commissioning.start();
        } catch(error) { this.log.error('[Marstek Shadow] Not started: %s', error.message); monitor.start(); }
      } else monitor.start();
    }
    const removed = [...this.cached.values()].filter(accessory => !expected.has(accessory.UUID));
    if (removed.length) {
      this.api.unregisterPlatformAccessories(PLUGIN, PLATFORM, removed);
      for (const accessory of removed) this.cached.delete(accessory.UUID);
    }
    if (devices.length) {
      this.log.info('[Marstek] %s Venus E 3.0 monitor(s) started; local reads only; hardware qualification pending.', devices.length);
      // Staleness advances even when a device hangs mid-poll.
      this.timer = setInterval(() => { for (const entry of this.entries.values()) this.publish(entry, entry.monitor.state()); }, 1000);
      this.timer.unref?.();
    }
  }
  bind(entry) {
    const { api } = this; const { Service: S, Characteristic: C } = api.hap;
    const Perms = api.hap.Perms || C.Perms;
    const Formats = api.hap.Formats || C.Formats;
    const { accessory: a, device: d, monitor } = entry;
    a.getService(S.AccessoryInformation).setCharacteristic(C.Manufacturer, 'Marstek')
      .setCharacteristic(C.Model, 'Venus E 3.0 (unqualified MVP)')
      .setCharacteristic(C.SerialNumber, `configured-${d.id}`);
    const service = (Type, name, subtype) => a.getServiceById(Type, subtype) || a.addService(Type, name, subtype);
    const level = service(S.Lightbulb, `${d.name} Battery`, 'battery-level'); level.setPrimaryService(true);
    const battery = service(S.Battery || S.BatteryService, `${d.name} Battery Status`, 'battery-status');
    const temperature = service(S.TemperatureSensor, `${d.name} Temperature`, 'temperature');
    const charging = service(S.MotionSensor, `${d.name} Charging`, 'charging');
    const discharging = service(S.MotionSensor, `${d.name} Discharging`, 'discharging');
    const read = getter => {
      const state = monitor.state();
      if (state.stale) throw new api.hap.HapStatusError(api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      return getter(state.sample.model);
    };
    const bind = (service, characteristic, getter) => {
      const value = service.getCharacteristic(characteristic);
      value.setProps({ perms: [Perms.PAIRED_READ, Perms.NOTIFY] });
      value.onGet(() => read(getter));
      return value;
    };
    entry.values = [
      [bind(level, C.On, () => true), () => true],
      [bind(level, C.Brightness, m => Math.round(m.socPercent)), m => Math.round(m.socPercent)],
      [bind(battery, C.BatteryLevel, m => Math.round(m.socPercent)), m => Math.round(m.socPercent)],
      [bind(battery, C.ChargingState, m => m.charging ? C.ChargingState.CHARGING : C.ChargingState.NOT_CHARGING), m => m.charging ? C.ChargingState.CHARGING : C.ChargingState.NOT_CHARGING],
      [bind(battery, C.StatusLowBattery, m => m.socPercent <= 20 ? 1 : 0), m => m.socPercent <= 20 ? 1 : 0],
      [bind(temperature, C.CurrentTemperature, m => m.temperatureC).setProps({ minValue: -40, maxValue: 100 }), m => m.temperatureC],
      [bind(charging, C.MotionDetected, m => m.charging), m => m.charging],
      [bind(discharging, C.MotionDetected, m => m.discharging), m => m.discharging]
    ];
    entry.faults = [temperature, charging, discharging].map(s => s.getCharacteristic(C.StatusFault));
    // Read-only numeric measurements visible in apps supporting custom characteristics.
    const extras = [
      ['Charge Power', 'D7AF3201-75F8-4E32-A720-EE89ED1B7101', 'chargePowerW', Formats.UINT16, 0, 10000, 'W'],
      ['Discharge Power', 'D7AF3202-75F8-4E32-A720-EE89ED1B7101', 'dischargePowerW', Formats.UINT16, 0, 10000, 'W'],
      ['AC Voltage', 'D7AF3203-75F8-4E32-A720-EE89ED1B7101', 'acVoltageV', Formats.FLOAT, 0, 300, 'V']
    ];
    let telemetry = a.services.find(service => service.UUID.toUpperCase() === 'D7AF3200-75F8-4E32-A720-EE89ED1B7101' && service.subtype === 'telemetry');
    if (!telemetry) telemetry = a.addService(new api.hap.Service(`${d.name} Measurements`, 'D7AF3200-75F8-4E32-A720-EE89ED1B7101', 'telemetry'));
    for (const [name, uuid, key, format, minValue, maxValue, unit] of extras) {
      let characteristic = telemetry.characteristics.find(c => c.UUID === uuid);
      if (!characteristic) {
        characteristic = new C(name, uuid, { format, minValue, maxValue, minStep: 0.1, unit, perms: [Perms.PAIRED_READ, Perms.NOTIFY] });
        telemetry.addCharacteristic(characteristic);
      }
      characteristic.onGet(() => read(m => m[key]));
      entry.values.push([characteristic, m => m[key]]);
    }
  }
  faultAccessory(accessory) {
    const { Characteristic: C, HapStatusError, HAPStatus } = this.api.hap;
    for (const service of accessory.services) for (const characteristic of service.characteristics) {
      if ([C.On.UUID, C.Brightness.UUID, C.BatteryLevel.UUID, C.CurrentTemperature.UUID, C.MotionDetected.UUID, C.ChargingState.UUID, C.StatusLowBattery.UUID].includes(characteristic.UUID) || characteristic.UUID.startsWith('D7AF320')) {
        characteristic.onGet(() => { throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE); });
        characteristic.updateValue(new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE));
      }
      if (characteristic.UUID === C.StatusFault.UUID) characteristic.updateValue(1);
    }
  }
  publish(entry, state) {
    const { HapStatusError, HAPStatus, Characteristic: C } = this.api.hap;
    for (const [characteristic, getter] of entry.values) characteristic.updateValue(state.stale
      ? new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE) : getter(state.sample.model));
    for (const fault of entry.faults) fault.updateValue(state.stale ? 1 : 0);
    if (state.sample) {
      const fw = state.sample.model.firmware;
      entry.accessory.getService(this.api.hap.Service.AccessoryInformation).updateCharacteristic(C.FirmwareRevision, `${fw.ems}.${fw.vms}.${fw.bms}`);
    }
  }
  isControlReady(){return this.config.marstekControlEnabled===true&&Boolean(this.controlSession?.qualified)&&!this.controlSession.externalHeld&&!this.controlSession.uncertain&&!this.commissioning?.busy;}
  stop() {
    this.shadow?.stop();clearInterval(this.timer);
    for(const entry of this.entries.values())entry.monitor.stop();
    this.started=false;this.entries.clear();
    const release=this.releaseOwnership;this.releaseOwnership=null;
    this.stopping=(async()=>{await this.commissioning?.stop();await this.controlSession?.close();release?.();})();
    return this.stopping;
  }
}
module.exports = { MarstekHomebridge, OWNER };
