> Historical private-preview engineering record. For current optional setup and scope, see [Optional Venus information](VENUS_OPTIONAL.md).

# Builds 6 and 7 — percentage journeys and simulated command lifecycle

Private **4.1.3-marstek.6**, based on 4.1.2 and the .5 preview. New command adapters are in-memory simulations, not physical transports; no sockets, Modbus writes or production actuation hook are included. The live Pi plugin and recorder remain unchanged.

## Build 6

Native HAP tests drive the actual percentage-control handlers. They cover saving a percentage while Off, percentage-before-On, On-before-percentage, redundant echoes, cancellation, competing clients, already-satisfied targets, missing members, stale readings, restart recovery and removal of preview accessories. A platform-constructor test verifies that preview suppresses the original timed tiles in runtime configuration while preserving the saved preferences.

A discovered issue was fixed: changing a running target previously cancelled its intent without revoking its authority token. A changed percentage now holds the authority before saving the new target. Redundant echoes of the unchanged percentage do not cancel the action. For a real percentage change, the conservative contract remains: stop the old intent and require On again. We do not silently retarget an executing action.

These are simulated command orderings through native HAP, not observations of every Apple Home client or an actual Apple Home UI visual test. A future physical writer must not dispatch an old target between separately received On/percentage changes without an explicit tested activation policy.

## Build 7

`SimulatedCommandLifecycle` uses a durable ActionAuthority and two in-memory devices. It validates owner, power envelope and lease before dispatch. Each device must provide fresh matching-identity power readback; ACK alone is insufficient. Independent peer failures remain visible.

Emergency Stop revokes authority first, awaits any older pending simulated writes, commands zero to both peers, reads both results and fences owners created during the stop. Dispatch is refused while a stop is in flight. A partial stop is reported when a peer ignores the command, is unreachable, reports stale values or identifies itself incorrectly. Telemetry channels are retained. Controller lease expiry requests the same verified stop. No raw-register recipe or restoration of unknown device settings is prescribed.

A negative test deliberately demonstrates the physical limitation: restarting the controller does not magically zero an already-running simulated battery with no watchdog. This remains an installation gate. The simulation can wait for its in-memory write promises; a real transport needs bounded timeouts, uncertain-outcome handling, readback and a qualified device watchdog. A lost controller cannot enforce a software-only lease. No simulation passing here proves physical emergency stopping.

## Reproduce

`npm run test:sim67` runs the native percentage journeys and command/stop simulations. `npm run simulate:lifecycle -- report.json` generates per-device execution/stop results for responsive, unreachable, ignored-command, stale-observation and stuck-discharge scenarios. Stuck/unreachable scenarios are expected partial-stop results; treating them as successful stops would fail validation.

All older weighted-SOC, Gateway replay, ownership, delayed/lossy plant, transport and HomeKit regression tests remain included. Evidence includes source and extracted-package test logs, scenario JSON and the source archive. This iteration does not claim a browser-render check of the configuration form or any installed Venus qualification.

The simulated write adapter also bounds an individual write at 100 ms (a test setting, not a proposed hardware timeout). A timed-out write has an unknown outcome: even if a subsequent zero command is observed, the stop remains partial because the old write could still arrive later. A dedicated never-completing-write test verifies this distinction. Physical transport qualification must resolve this uncertainty rather than assume cancellation of an outstanding packet.
