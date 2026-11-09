> Historical private-preview engineering record. For current optional setup and scope, see [Optional Venus information](VENUS_OPTIONAL.md).

# Builds 1–3: Gateway replay, coordinator hardening and action authority

Private **4.1.3-marstek.5**, based on 4.1.2/.4. All battery outputs remain shadow proposals. This private package is marked private to avoid publishing its household replay fixture. Live bridge/plugin configuration and the Pi recorder are unchanged.

## Build 1 — observations and replay

The existing Pi bank was inspected in its authenticated terminal. Summary window: 2026-11-05 08:25:43.119–09:40:27.873 UTC. 1,989 records; 1,877 profile-valid. Median interval 2,000 ms, maximum gap 30,024 ms; median valid collection span 505 ms and p95 791 ms. A slightly later failure audit counted 21 receive timeouts, 87 connect timeouts and six invalid snapshot spans; these are a later window, so do not equate the count to the earlier summary's rejected total. This establishes a meaningful read-failure rate, not fault-free operation. No attempt was made to bypass those quality gates or increase traffic.

Thirty evenly distributed **valid** observations were transferred as a compact replay dataset, SHA-256 verified against the Pi export: `42311564812582a1535f21d175171d3b4436e4c36db9461b8a79bebf3376d556`. Columns retain timestamps, signed net grid export, signed AIO discharge, PV, household load, AIO SOC and collection span. The full-resolution bank, failed records and original raw banks remain on the Pi. The compact sample is not a replacement for that evidence. It currently covers morning behaviour only, not an overnight or evening export cycle.

`npm run replay:gateway -- tools/fixtures/gateway-real-replay.json report.json` generates replay proposals. Gateway values are real; Venus SOC/power and export intent are explicitly synthetic because Venus is not installed. Recorded grid power describes the historical site: this is open-loop planner replay, not proof of a closed-loop physical response. The tool also accepts a raw observer JSONL file and reports quality, gaps, regressions and error categories. Malformed records are counted rather than silently treated as good data.

## Build 2 — a single shadow decision path

When site preview is enabled, ShadowService uses the site plan provider instead of invoking the earlier Venus-only policy. The earlier policy remains available when site preview is disabled. There are not two active proposal authorities for the selected battery.

A proposal guard now limits increases to 300 W per fresh pair, permits immediate reductions, requires zero through a reversal and refuses old/duplicated observations to renew a lease. Duplicate data cannot preserve an emergency-stop request or reverse direction. Explicit tests exercise lost readings, clock regressions, changing grid headroom and thousands of synthetic load/PV cases. The existing .3 delayed/lossy plant tests remain part of regression coverage. Export-limit results concern calculated requested headroom, not guaranteed instantaneous physical export.

## Build 3 — action ownership and durable recovery

The identity-bound authority journal is separate from target preferences. Atomic commits record owner, generation, active token, durable holds and completed occurrence keys. A superseded token cannot authorise new work. Restart with an active owner records a recovery hold; old work is never resumed. Identity mismatch, corruption and storage failure refuse authority. Automatic overnight/IOG ownership is now journalled, and completed occurrence/target records survive restart so SOC drift cannot restart the same completed action.

Emergency Stop, configured hold, external ownership and prolonged stale telemetry hold this site authority. A manual cancellation also holds automatic takeover. Explicit activation of a new percentage action acknowledges the hold. Only one owner can be active. The existing AIO controller still owns its physical actions; site output remains shadow-only. Changing the installation identity requires deliberate journal handling, not automatic migration or replay.

This journal does not replace GivEnergy's established recovery logic and does not prove native Venus command expiry, physical Emergency Stop or safe settings restoration. The next physical stage must qualify those behaviours on installed hardware and replace proposed leases with proven device behaviour.

## Validation limits

Stage 1/2's initial four acceptance cases passed before action-authority work began. The final suite adds source replay, single-provider selection, guard safety, authority persistence, generation fencing, write failures and automatic-completion restart integration. Native HAP dimmer coverage and prior full regressions are retained. Separate source/packed-package logs and replay outputs are delivered in the review bundle. No actual UI browser-render check or physical battery-command test is claimed in this iteration.
