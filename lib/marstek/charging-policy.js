'use strict';
const { GatewayMeterController } = require('./meter-controller');
// Pure policy. Output is proposed AC power, never a device command.
class ChargingPolicy {
  constructor(options = {}) {
    this.options = { ...options, maxAgeMs: 6000, maxSkewMs: 2500, leaseMs: 7000 };
    this.meter = new GatewayMeterController(this.options);
    this.previous = null;
    this.completed = new Set();
  }
  step({ gateway, venus, nowMs, context = {} }) {
    const zero = reason => { this.previous = null; this.meter.last = null; return { kind: 'stop', powerW: 0, reason, dryRun: true, leaseUntilMs: nowMs, hardwareQualified: false }; };
    if (!Number.isFinite(nowMs)) throw new Error('Policy time required');
    if (context.emergencyStop || context.automationHold) return zero(context.emergencyStop ? 'emergency-stop' : 'automation-hold');
    // Reuse the controller's full freshness/direction/physical-range validation.
    const check = new GatewayMeterController(this.options).step({ gateway, venus, nowMs });
    if (check.kind === 'stop') return zero(check.reason);
    let source = null, target = null, end = null;
    if (context.overnightEnabled && context.nightActive) {
      if (context.nightSuppressed) return zero('overnight-occurrence-stopped');
      source = 'overnight'; target = context.nightTargetSoc ?? 100; end = context.nightEndAtMs;
    } else if (context.iogEnabled) {
      if (!context.iogFresh || !Number.isFinite(context.iogFetchedAtMs) || context.iogFetchedAtMs > nowMs || nowMs-context.iogFetchedAtMs > (context.iogFreshForMs ?? 120000)) return zero('iog-data-stale');
      if (context.iogActive) {
        if(context.iogSuppressed)return zero('iog-occurrence-stopped');
        if (context.iogMode === 'pauseBoth') return zero('iog-pause-both');
        if (context.iogMode === 'pauseCharge' || context.iogMode === 'pauseDischarge') {
          this.previous = null;
          return { ...this.meter.step({ gateway, venus, nowMs, pauseCharge: context.iogMode === 'pauseCharge', pauseDischarge: context.iogMode === 'pauseDischarge' }), source: 'iog', reason: `iog-${context.iogMode}` };
        }
        if (context.iogMode !== 'charge') return zero('invalid-iog-mode');
        source = 'iog'; target = context.iogTargetSoc ?? 100; end = context.iogEndAtMs;
      }
    }
    if (!source) {
      this.previous = null;
      return this.meter.step({ gateway, venus, nowMs });
    }
    this.meter.last = null;
    if (!Number.isInteger(target) || target < 4 || target > 100 || !Number.isFinite(end) || end <= nowMs) return zero('invalid-charge-window-or-target');
    const completionKey = `${source}:${end}:${target}`;
    if (venus.socPercent >= target || this.completed.has(completionKey)) {
      if(this.completed.size>=64)this.completed.delete(this.completed.values().next().value);
      this.completed.add(completionKey);
      return { ...zero('target-reached-protected'), source, targetSoc: target };
    }
    // Do not draw energy out of an AIO which is currently supplying the AC bus.
    if (gateway.aioDischargeW > 50) return { ...zero('await-aio-charge-or-pause'), source, targetSoc: target };
    if (this.previous && (nowMs < this.previous.at || gateway.observedAtMs < this.previous.gAt || venus.observedAtMs < this.previous.vAt)) return zero('time-regression');
    const key = `${source}:${context.occurrenceId || end}`;
    if (this.previous && key === this.previous.key && nowMs < this.previous.leaseUntilMs && (gateway.observedAtMs === this.previous.gAt || venus.observedAtMs === this.previous.vAt)) return { ...this.previous.request, kind: 'wait', reason: 'await-fresh-pair' };
    const prior = this.previous && key === this.previous.key && nowMs < this.previous.leaseUntilMs ? this.previous.powerW : 0;
    const dt = this.previous ? Math.max(0,Math.min(1,(nowMs-this.previous.at)/1000)) : 1;
    const powerW = -Math.round(Math.min(this.meter.config.maxChargeW, Math.abs(Math.min(0, prior)) + this.meter.config.rampWPerSecond*dt));
    const request = { kind: 'request', source, targetSoc: target, powerW, reason: `${source}-charge`, dryRun: true,
      leaseUntilMs: Math.min(end, nowMs + this.options.leaseMs), occurrenceId: key, hardwareQualified: false };
    this.previous = { key, at: nowMs, gAt: gateway.observedAtMs, vAt: venus.observedAtMs, powerW, leaseUntilMs: request.leaseUntilMs, request };
    return request;
  }
}
module.exports = { ChargingPolicy };
