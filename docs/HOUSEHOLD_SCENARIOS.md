> Historical private-preview engineering record. For current optional setup and scope, see [Optional Venus information](VENUS_OPTIONAL.md).

# Amended build 4 — household scenario and transition harness

Private **4.1.3-marstek.7**, based on 4.1.2 and the .6 simulation preview. No physical battery writes or live deployment.

## Situations rather than a typical day

Fifteen household stories cover: late EV arrival and a changed target; clouds and cooking; two people choosing conflicting actions; On arriving before a new slider value; repeated automation changes; a kettle finishing during export followed by returning PV; router restart and premature retry; one battery disappearing; Homebridge restart and later manual resumption; direct inverter intervention; an attempt to export below reserve; Emergency Stop versus another automation; overlapping overnight/IOG periods; an uncommissioned import allowance; and repeated stale readings while load changes.

Each story runs with seeds 1, 42 and 2026. Seeds vary domestic demand noise, device response between two and five seconds, and command delay of two, four or six seconds. They are reproducible variations, not a statistical model of household behaviour or evidence of real-life probabilities. Each episode lasts fifteen simulated minutes. A separate twenty-minute sequence carries energy and controller state across export, cancellation, overnight, EV arrival, restart and manual intervention. There is no fixed typical-day profitability target.

Native HAP percentage handlers, SiteHomebridge, SiteCoordinator, ProposalGuard, durable target state and ActionAuthority are exercised together under an injected clock. The plant models two capacities (13.5/5.12 kWh), 92% charge efficiency, 94% discharge efficiency and lagged AC response. Local queued proposals check authority generation before simulated dispatch. Simulated lease expiry and battery reserve gates are assumptions, not proven device features. PV/load/EV changes are explicit scripted events plus seeded noise. Tariff contexts are injected; the harness does not itself replay the complete Octopus fetcher or clock scheduler. Prior clock-window, replay and lifecycle suites remain separate regression coverage.

Reports retain every interaction outcome, thirty-second state/decision snapshots, energy totals, maxima, time spent held and rejected interactions. Tests check finite state, request power envelopes, missing/held membership, stale proposals and reserve behaviour, plus meaningful outcomes such as rejecting a premature retry and refusing charge without a budget. The same seed must reproduce the same physics and decisions.

## Issues found and corrected

1. A manually requested Charge target could inherit the completed-occurrence key of an unrelated overnight target. Automatic completion keys are now scoped only to automatic requests.
2. A held planner could retain a computed `complete` flag and incorrectly journal an automatic target as achieved. Held results now explicitly clear completion and reachability.
3. Full-rate discharge up to the measured reserve left insufficient energy for delayed response. Export requests now taper against energy above each reserve using a conservative fifteen-second response horizon. This is a software planning allowance to qualify on hardware, not a proven physical reserve guarantee.

Focused regressions accompany each change. Changing a running target still cancels and requires explicit activation; this is conservative product behaviour, not seamless retargeting. A cancellation or external owner may deliberately leave automation held until explicit resumption.

## Important limitation exposed

The peak/PV scenario keeps the AIO's independently owned export output at 6 kW while PV returns. The Venus planner reduces its contribution to zero, yet whole-site export can exceed 6 kW. The report counts and flags this exposure. Passing behavioural tests must not be read as a hard export-cap pass. Coordinated AIO/PV curtailment and physical commissioning are required; no new physical AIO override is introduced by this harness.

The model also records import transients rather than claiming polling can prevent every instantaneous peak. It feeds stale observation states through existing gates during network-loss stories; this is not a virtual recreation of every real transport or interval timer. Native device watchdogs, uncertainty after in-flight writes and physical Emergency Stop remain installation gates, as explicitly demonstrated by the earlier command-lifecycle tests.

## Reproduce

`npm run test:household` runs the stories, deterministic replay, joined transition and outcome/limitation checks. `npm run simulate:household -- report.json` generates all 45 seeded runs. The review bundle additionally includes the joined-transition JSON and a readable per-story result table. These are synthetic scenarios; the earlier private Gateway fixture remains labelled real Gateway/synthetic Venus in its own replay tool.

The export counterexample is conditional on the AIO maintaining its independent output and PV being an additional site contribution. It is not a finding that the live 4.1.2 controller or this household actually ignores PV. Its purpose is to expose what the Venus-only assistance path cannot guarantee if the other controller does not curtail in time.
