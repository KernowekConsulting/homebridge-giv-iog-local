'use strict';
const DEFAULTS = Object.freeze({ mode: 'residual', maxChargeW: 2500, maxDischargeW: 800,
  reserveSoc: 20, chargeCeilingSoc: 100, deadbandW: 50, gain: 0.5, rampWPerSecond: 300,
  maxAgeMs: 3000, maxSkewMs: 1000, leaseMs: 5000, exportLimitW: 6000, exportMarginW: 200 });
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
class GatewayMeterController {
  constructor(options = {}) {
    this.config = { ...DEFAULTS, ...options };
    const c = this.config;
    for (const key of Object.keys(DEFAULTS).filter(k => k !== 'mode')) if (!Number.isFinite(c[key])) throw new Error(`Invalid ${key}`);
    if (!['residual', 'house-support'].includes(c.mode) || c.maxChargeW < 0 || c.maxChargeW > 2500 || c.maxDischargeW < 0 || c.maxDischargeW > 2500 || c.reserveSoc < 0 || c.chargeCeilingSoc > 100 || c.reserveSoc >= c.chargeCeilingSoc || c.gain <= 0 || c.gain > 1 || c.deadbandW < 0 || c.rampWPerSecond <= 0 || c.maxAgeMs <= 0 || c.maxSkewMs < 0 || c.leaseMs <= c.maxAgeMs || c.exportMarginW < 0 || c.exportLimitW <= c.exportMarginW) throw new Error('Invalid controller policy');
    if (c.maxDischargeW > 800 && options.higherDischargeLimitConfirmed !== true) throw new Error('Discharge above 800 W requires confirmation of an already commissioned limit');
    this.last = null;
  }
  step({ gateway: g, venus: v, nowMs, enabled = true, pauseCharge = false, pauseDischarge = false, emergencyStop = false }) {
    const c = this.config;
    const zero = reason => { this.last = null; return { kind: 'stop', powerW: 0, reason, dryRun: true, leaseUntilMs: nowMs, hardwareQualified: false }; };
    if (!Number.isFinite(nowMs)) throw new Error('Controller time required');
    if (emergencyStop || !enabled) return zero(emergencyStop ? 'emergency-stop' : 'disabled');
    if (!g || !v) return zero('missing-telemetry');
    for (const sample of [g, v]) if (!Number.isFinite(sample.observedAtMs) || nowMs < sample.observedAtMs || nowMs - sample.observedAtMs > c.maxAgeMs) return zero('stale-or-future-telemetry');
    if (Math.abs(g.observedAtMs - v.observedAtMs) > c.maxSkewMs) return zero('sample-skew');
    if (![g.gridExportW, g.aioDischargeW, v.acDischargeW, v.socPercent].every(Number.isFinite) || Math.abs(g.gridExportW) > 30000 || Math.abs(g.aioDischargeW) > 20000 || Math.abs(v.acDischargeW) > 3000 || v.socPercent < 0 || v.socPercent > 100 || !v.acDirectionQualified) return zero('invalid-or-unqualified-telemetry');
    if (this.last && (nowMs < this.last.at || g.observedAtMs < this.last.gAt || v.observedAtMs < this.last.vAt)) return zero('time-regression');
    if (this.last && nowMs >= this.last.leaseUntilMs) this.last = null;
    // Repeated frames never refresh a power lease or produce another ramp step.
    if (this.last && (g.observedAtMs === this.last.gAt || v.observedAtMs === this.last.vAt)) return { kind: 'wait', powerW: this.last.powerW, reason: 'await-fresh-pair', dryRun: true, leaseUntilMs: this.last.leaseUntilMs, hardwareQualified: false };
    const error = -g.gridExportW + (c.mode === 'house-support' ? Math.max(0, g.aioDischargeW) : 0);
    let target = v.acDischargeW + (Math.abs(error) <= c.deadbandW ? 0 : c.gain * error);
    let min = -c.maxChargeW, max = c.maxDischargeW;
    // Do not serve another battery's deliberate charge or absorb its discharge.
    if (pauseCharge || v.socPercent >= c.chargeCeilingSoc || g.aioDischargeW > c.deadbandW) min = 0;
    if (pauseDischarge || v.socPercent <= c.reserveSoc || g.aioDischargeW < -c.deadbandW) max = 0;
    // Advisory headroom only; AIO/PV can change after this observation.
    max = Math.min(max, Math.max(0, v.acDischargeW + c.exportLimitW - c.exportMarginW - g.gridExportW));
    target = clamp(target, min, max);
    const prior = this.last ? this.last.powerW : 0;
    const dt = this.last ? Math.min(1, Math.max(0, (nowMs - this.last.at) / 1000)) : 1;
    let powerW = clamp(target, prior - c.rampWPerSecond * dt, prior + c.rampWPerSecond * dt);
    powerW = clamp(powerW, min, max); // reserve/pause gates override ramp immediately
    if (prior * powerW < 0) powerW = 0; // pass through zero on reversals
    powerW = Math.round(powerW);
    this.last = { at: nowMs, gAt: g.observedAtMs, vAt: v.observedAtMs, powerW, leaseUntilMs: nowMs + c.leaseMs };
    return { kind: 'request', powerW, reason: c.mode, dryRun: true, leaseUntilMs: this.last.leaseUntilMs, hardwareQualified: false };
  }
}
// Simulation sink, deliberately contains no socket, register writer or API client.
class SimulatedVenusActuator {
  constructor() { this.powerW = 0; this.expiresAtMs = 0; }
  accept(request) {
    if (request.dryRun !== true || !['request', 'stop', 'wait'].includes(request.kind)) throw new Error('Simulation requests only');
    if (request.kind === 'wait') return;
    this.powerW = request.powerW; this.expiresAtMs = request.leaseUntilMs;
  }
  output(nowMs) { if (nowMs >= this.expiresAtMs) this.powerW = 0; return this.powerW; }
}
module.exports = { GatewayMeterController, SimulatedVenusActuator, DEFAULTS };
