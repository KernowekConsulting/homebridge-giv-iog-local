'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { save } = require('./commissioning');
const HALF_HOUR_MS = 30 * 60000;
const MAX_SAMPLE_GAP_MS = 30000;
const RETENTION_MS = 14 * 86400000;

function observe(channel, at, watts, soc, startAt, endAt, continuing) {
  if (!Number.isFinite(at) || !Number.isFinite(watts) || at > endAt || at < startAt || at <= (channel.lastAt ?? -Infinity)) return;
  const elapsed = at - channel.lastAt;
  if (continuing && elapsed > 0 && elapsed <= MAX_SAMPLE_GAP_MS) {
    // Integrate only intervals bounded by two observations from the same source.
    channel.outWh += (Math.max(0, channel.lastW) + Math.max(0, watts)) * elapsed / 7200000;
    channel.inWh += (Math.max(0, -channel.lastW) + Math.max(0, -watts)) * elapsed / 7200000;
    channel.coveredMs += elapsed;
  }
  if (!Number.isFinite(channel.firstAt)) channel.firstAt = at;
  channel.lastAt = at;
  channel.lastW = watts;
  channel.peakOutW = Math.max(channel.peakOutW ?? 0, watts);
  channel.peakInW = Math.max(channel.peakInW ?? 0, -watts);
  if (watts > 30) { channel.firstOutAt ??= at; channel.lastOutAt = at; }
  if (watts < -30) { channel.firstInAt ??= at; channel.lastInAt = at; }
  if (Number.isFinite(soc)) {
    channel.startSoc ??= soc;
    channel.endSoc = soc;
  }
}

class OperationEvidence {
  constructor(storage, log) {
    this.storage = storage;
    this.log = log;
  }

  openDay(nowMs) {
    const day = new Date(nowMs).toISOString().slice(0, 10);
    if (this.day === day) return;
    this.day = day;
    this.file = path.join(this.storage, 'battery-operations-' + day + '.json');
    this.windows = {};
    this.lastKey = null;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data.schema === 1 && data.windows && typeof data.windows === 'object') this.windows = data.windows;
    } catch (error) {
      if (error.code !== 'ENOENT') this.log.warn?.('[Marstek] Battery evidence could not be read: %s', error.message);
    }
    for (const name of fs.readdirSync(this.storage)) {
      const match = /^battery-operations-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
      if (match && Date.parse(match[1]) + 86400000 < nowMs - RETENTION_MS) fs.unlinkSync(path.join(this.storage, name));
    }
  }

  record({ gateway, venus, context, nowMs }, plan, intent, hold) {
    this.openDay(nowMs);
    const exportObserved = context.exportActive || Boolean(context.exportSource && context.exportOccurrence);
    const overnight = context.nightActive && context.overnightEnabled;
    const kind = context.iogActive && context.iogEnabled && !overnight ? (context.iogGraceActive ? 'iog-grace' : 'iog') :
      overnight ? 'cheap-overnight' :
        exportObserved ? context.exportSource || 'scheduled-export' :
          intent ? (intent.mode === 'export' ? 'export-to' : 'charge-to') : 'eco';
    const operation = kind === 'cheap-overnight' ? context.nightEndAtMs :
      kind.startsWith('iog') ? context.iogEndAtMs :
        exportObserved ? context.exportOccurrence : intent?.deadlineMs;
    const start = Math.floor(nowMs / HALF_HOUR_MS) * HALF_HOUR_MS;
    const key = JSON.stringify([start, kind, operation ?? null]);
    const initial = () => ({ outWh: 0, inWh: 0, coveredMs: 0 });
    const bucket = this.windows[key] ||= {
      fromMs: nowMs, untilMs: nowMs, kind, operation: operation ?? null,
      aio: initial(), venus: initial(), grid: initial(), transitions: []
    };
    if (nowMs < bucket.untilMs) return;
    const continuing = this.lastKey === key;
    if (!continuing && this.lastKey && this.windows[this.lastKey]) {
      this.windows[this.lastKey].nextObservedOperation = { atMs: nowMs, kind, operation: operation ?? null };
    }
    bucket.untilMs = nowMs;
    const previous = bucket.transitions.at(-1);
    const reason = plan?.reason ?? 'unavailable';
    const transition = !continuing || previous?.reason !== reason || previous?.hold !== hold;
    if (transition) {
      bucket.transitions.push({ atMs: nowMs, reason, hold });
      if (bucket.transitions.length > 32) bucket.transitions.splice(1, 1);
    }
    bucket.maxRequestedChargeW = Math.max(bucket.maxRequestedChargeW ?? 0, -(plan?.venusW || 0));
    bucket.maxRequestedDischargeW = Math.max(bucket.maxRequestedDischargeW ?? 0, plan?.venusW || 0);
    bucket.targetSoc = plan?.targetSoc ?? plan?.chargeTargetSoc ?? bucket.targetSoc;
    bucket.plannedExportKwh = context.exportExpectedKwh ?? bucket.plannedExportKwh;
    bucket.plannedExportBatteryKwh = context.exportExpectedBatteryKwh ?? bucket.plannedExportBatteryKwh;
    bucket.exportPricePence = context.exportPricePence ?? bucket.exportPricePence;

    const usableAt = at => Number.isFinite(at) && nowMs - at >= 0 && nowMs - at < MAX_SAMPLE_GAP_MS;
    const g = gateway?.identityFault || gateway?.unavailable ? null : gateway;
    const direct = context.aioEvidence;
    const gatewayAioAt = g?.topologyObservedAtMs ?? g?.observedAtMs;
    const gatewayAio = g?.units?.length && usableAt(g.observedAtMs) && usableAt(gatewayAioAt);
    const aio = gatewayAio ? {
      at: gatewayAioAt, watts: g.aioDischargeW,
      soc: g.units.reduce((sum, unit) => sum + unit.socPercent, 0) / g.units.length,
      source: g.aioPowerSource || g.siteMeterSource || 'gateway'
    } : direct?.identityVerified && direct.singleAio ? {
      at: direct.observedAtMs, watts: direct.acDischargeW, soc: direct.socPercent, source: 'aio'
    } : null;
    if (aio && usableAt(aio.at) && Number.isFinite(aio.watts)) {
      bucket.aio.sources = [...new Set([...(bucket.aio.sources ?? []), aio.source])];
      observe(bucket.aio, aio.at, aio.watts, aio.soc, bucket.fromMs, nowMs,
        continuing && this.lastAioSource === aio.source && this.aioContinuous);
      this.lastAioSource = aio.source;
      this.aioContinuous = true;
    } else this.aioContinuous = false;

    this.venusContinuous = this.recordChannel(bucket.venus, venus?.identityQualified && venus.acDirectionQualified,
      venus?.observedAtMs, venus?.acDischargeW, venus?.socPercent, bucket, usableAt, continuing && this.venusContinuous);
    const meterAt = g?.meterObservedAtMs ?? g?.observedAtMs;
    const meterSource = g?.siteMeterSource === 'aio' ? 'aio' : 'gateway';
    if (g && usableAt(meterAt) && Number.isFinite(g.gridExportW)) {
      bucket.grid.sources = [...new Set([...(bucket.grid.sources ?? []), meterSource])];
    }
    this.gridContinuous = this.recordChannel(bucket.grid, Boolean(g),
      meterAt, g?.gridExportW, null, bucket, usableAt, continuing && this.gridContinuous && this.lastMeterSource === meterSource);
    this.lastMeterSource = meterSource;
    this.lastKey = key;

    if (this.savedAt && nowMs - this.savedAt < 30000 && continuing) return;
    this.savedAt = nowMs;
    try { save(this.file, { schema: 1, updatedAtMs: nowMs, windows: this.windows }); }
    catch (error) { this.log.warn?.('[Marstek] Battery evidence could not be saved: %s', error.message); }
  }

  recordChannel(channel, valid, at, watts, soc, bucket, usableAt, continuing) {
    if (!valid || !usableAt(at) || !Number.isFinite(watts)) return false;
    observe(channel, at, watts, soc, bucket.fromMs, bucket.untilMs, continuing);
    return true;
  }
}

module.exports = { OperationEvidence };
