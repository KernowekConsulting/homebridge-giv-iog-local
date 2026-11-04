'use strict';

const { classifySerialPrefix } = require('./profile-detector');

// Control layout and optional features are independent. A readable bank full of
// zeroes, battery capacity, or output rating does not establish a capability.
function recogniseControlCapabilities({ serial, modelCode, armFirmware } = {}) {
  const hint = classifySerialPrefix(serial);
  const dtc = Number.isInteger(modelCode) && modelCode > 0 && modelCode <= 0xffff
    ? modelCode.toString(16).padStart(4, '0') : '';
  const firmwareKnown = Number.isInteger(armFirmware) && armFirmware > 0 && armFirmware < 0xffff;
  let family = 'unsupported', slotCount = 0, pauseMode = false, pauseTimes = false;
  let commandSupported = false, additionalAcLimits = [];
  if (/^30/.test(dtc)) {
    family = 'ac-single-phase'; slotCount = 2;
    commandSupported = ['3001', '3002'].includes(dtc) && hint.family === 'ac_coupled_candidate';
    pauseMode = firmwareKnown && armFirmware >= 202;
    additionalAcLimits = [313, 314];
  } else if (/^80/.test(dtc)) {
    family = 'aio-single-phase'; slotCount = 10; pauseMode = true; pauseTimes = true;
    commandSupported = ['8001', '8002', '8003'].includes(dtc) && hint.family === 'aio';
    additionalAcLimits = [313, 314];
  } else if (/^20/.test(dtc)) {
    family = 'hybrid-single-phase';
    const generation = Math.floor(armFirmware / 100);
    slotCount = firmwareKnown && generation === 3 && armFirmware > 302 ? 10 : 2;
    commandSupported = ['2001', '2002', '2003'].includes(dtc) && hint.family === 'hybrid_candidate';
  } else if (/^(81|83)/.test(dtc)) {
    family = 'hybrid-single-phase-extended'; slotCount = 10;
  } else if (/^(4|6|82)/.test(dtc)) family = 'three-phase';
  else if (/^5/.test(dtc)) family = 'ems';
  else if (/^7/.test(dtc)) family = 'gateway';
  else if (/^2/.test(dtc)) { family = 'hybrid-modelled'; slotCount = 2; }
  return Object.freeze({ serial, modelCode, armFirmware, family,
    commandSupported: commandSupported && firmwareKnown && /^[A-Z]{2}\d{4}[A-Z]\d{3}$/.test(serial || ''),
    slots: Object.freeze({ count: slotCount, layout: slotCount === 10 ? 'extended' : slotCount === 2 ? 'core' : 'separate' }),
    pause: Object.freeze({ mode: pauseMode, times: pauseTimes }),
    // Preserve the project's established command-power route. AC ceilings are
    // separate profile evidence, never inferred from pause or slot-bank presence.
    power: Object.freeze({ charge: slotCount ? 111 : null, discharge: slotCount ? 112 : null,
      additionalAcLimits: Object.freeze(additionalAcLimits), additionalAcLimitWrites: false }) });
}

module.exports = { recogniseControlCapabilities };
