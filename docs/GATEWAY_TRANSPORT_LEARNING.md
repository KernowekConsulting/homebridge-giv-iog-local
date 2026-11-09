# Applying GivModbus learning to the Gateway

Review date: 6 November 2026. This is an engineering evidence note, not a new user setup requirement or permission to enable writes.

## What the project already learned

The read-only retrospective in `sources/givhome-hb-modbus-retrospective.zip` describes the evidence-led transition to direct local control: one controller, validated YY-framed responses, explicit ownership, adaptive readback, bridge survival, and agreement between logs, register truth and Home before claiming a pass.

The stable 4.1.2 `lib/direct-modbus-client.js` implements `gracefulContinuityRead`: three short opportunities (350 ms connect / 650 ms response), 125 ms fresh-attempt gaps, followed by a generous opportunity (3750 ms connect / response). Each attempt uses a fresh socket; matching requires the expected function, unit, register base and count. Heartbeats and unrelated frames are handled separately. Persistent socket reuse is therefore not the established proven pattern in this implementation.

The stable `stage5-live-write-harness` distinguishes retryable pre-send connection failures from uncertain post-send outcomes. That distinction must survive any eventual Venus actuator work. Read retries are not a licence to repeat an uncertain write.

The earlier optional-Venus consolidation review deliberately did not copy the complete Graceful budget into the short snapshot deadline. The Gateway recorder currently uses three short banks, single-attempt reads, a 1250 ms connection timeout, a 3000 ms response timeout, a two-second accepted snapshot span and failure backoff up to 30 seconds. This is an observation policy, not a demonstrated optimum for this Gateway. Both that choice and the full Graceful pattern need measurement against current hardware.

## Controlled comparison on the Pi

Used the installed, known-good GivModbus reader and only IR reads through 192.168.0.103:8899, unit 17, expected GW2412G068. Temporarily stopped only the observation service; an EXIT trap restarted it automatically. Live Homebridge and its inverter controls were not restarted or modified. The deliberate observation gap must remain visible in future dataset analysis.

Interleaved two rounds of:

- Current single-attempt short banks: 1600/20, 1700/5, 1800/20.
- Existing per-bank Graceful over those banks.
- Existing Graceful wrapped around a fresh complete short-bank snapshot; failed partial snapshots are discarded.
- Existing per-bank Graceful over the documented core 60-word banks at 1600, 1660 and 1780. The 1720 energy-history bank was unnecessary for this core-reading comparison.

Every accepted result still requires serial, unit, function, base, count, valid words and a snapshot span of at most two seconds. No stale readings are relabelled fresh.

All eight trials failed those criteria. Most failed before a Modbus request could be sent (connection timeout / host unreachable). The second documented-bank trial recovered complete bank responses but took 2209 ms and was rejected by the span check. This is a small failed qualification run, not a statistically useful comparison of long-term success rates. It does not justify adopting a transport policy or relaxing freshness.

The full raw report and console log remain on the Pi in the observation data directory as `transport-study-20261106.json` and `.log`. The tested probe source, tests and checksum are archived with the local evidence. Its source SHA-256 was verified before execution.

## What to try next

Separate reachability, coherent bank acquisition, planner freshness and Home notification delivery in the evidence. They are different failure classes. Compare fresh whole-snapshot recovery with the existing pattern during representative conditions, with only one observer reading the Gateway. Measure connection time, response time, failed opportunities, accepted span and age at consumption. Consider a small fast site-power bank and slower identity/topology/SOC reads only if timestamps, coherent membership and the control freshness rules remain explicit.

Do not copy the inverter's long telemetry interval into site control; equally, do not assume direct Modbus guarantees a fresh sample every two seconds. Retrying can improve acquisition, but an expired command must still stop and manual requests must not silently resume. Gateway telemetry cannot replace a qualified Venus device-side timeout or an installation's independent export protection.
