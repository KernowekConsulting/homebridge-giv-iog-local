> Historical private-preview engineering record. For current optional setup and scope, see [Optional Venus information](VENUS_OPTIONAL.md).

# Marstek MVP validation record

Date: 4 November 2026. Private package: `homebridge-giv-iog-local@4.1.3-marstek.0`.
Baseline: GivHome 4.1.2 (`031ecc1cdaab983beb7ba3b4ead8b2f553771ee7`).

## Software evidence

- Full default test command passed on Node 22.23.4 and Node 24.22.2.
- 402 existing test-runner cases passed per runtime, covering charge/control lifecycle, beta controls, solar observation, configuration and CE AC-coupled capabilities. Existing release, forecast and documentation checks also passed.
- 22 additional Marstek cases passed per runtime: 15 transport/profile/monitor cases and 7 native HomeKit/platform cases.
- The separate original native HomeKit suite passed all 18 cases on both runtimes, using Homebridge 2.4.0 and HAP 2.2.2.
- Local TCP tests use a simulator bound only to 127.0.0.1; no battery or inverter is contacted.
- End-to-end coverage starts the actual GivHome platform, reads the TCP simulator through the production monitor, publishes a real HAP accessory and confirms Marstek data never becomes the GivEnergy telemetry model.

Total test-runner coverage is 424 cases in the default command plus 18 separate baseline native HomeKit cases, per runtime. Source and packed-package logs are delivered with the review bundle; repeated runs are not additional unique cases.

## Behaviour covered

- Literal Modbus addresses, FC03-only traffic, decoded SOC/temperature/voltage/power and signed direction.
- Fragmented responses and serialisation of concurrent readers.
- Rejection of bad transaction IDs, units, protocol IDs, function codes, byte counts and lengths.
- Timeouts, dropped connections, Modbus exceptions and successful later reconnection.
- Cancellation of queued/in-flight reads on close.
- Unknown models, invalid ranges and incomplete snapshots.
- Retaining observation time through short failures; age-based expiry and recovery; no late sample publication after stop.
- Read-only native HomeKit characteristics, communication faults on stale data and recovery.
- Separate battery UUIDs, retained identity after name/IP change, explicit removal and invalid-config cache retention.
- Existing configuration migration preserves Marstek entries.
- Existing GivEnergy controls, native accessories and CE AC-coupled capability tests continue to pass.

## Not established

- No physical Venus E 3.0 has been installed or tested.
- The community register map is not a qualified Marstek firmware profile. Power direction, SOC scale, supported blocks and device name must be confirmed on arrival.
- Physical-device identity binding, real network recovery, Wi-Fi support and a long-duration hardware soak remain unqualified.
- Native HomeKit tests do not establish the final tile grouping or visual layout in the iPhone Home app. Homebridge 1.x runtime compatibility has not been exercised in this task.
- No Marstek control writes, autonomous dispatch, IOG protection, charging targets, schedule preservation, Emergency Stop parity, site export limiting or multi-battery control are implemented or certified by this MVP.
- The attached paper is an informative reference; its uncorroborated write addresses and fixed export timetable are excluded.
