# Private Venus priority comparison — 11 November 2026

Two independently packaged candidates retain the existing version names: Modbus 4.2.0-beta.1 and Local API 4.2.0-beta.1b. Source and package hashes distinguish these private revisions from previous packages. Neither is to be published or installed automatically. The live Pi is unchanged by this build task. Public release wording remains “Beta Marstek Addon. Not for public use”.

## Shared implementation

The existing AIO charging, Octopus polling and interpretation remain the authority. The new Venus priority branch consumes their context and reuses successful AIO telemetry polls; it adds no AIO polling connection. IOG protection takes precedence over manual export and overlapping overnight plans. An active pause policy produces zero Venus power. Unknown Octopus state cannot authorise Eco/export discharge. Operator holds, external control ownership and commissioning gates remain in force.

Scheduled charging is separated from site-meter following. A qualified Venus observation must be less than six seconds old. A fresh qualified Gateway observation may establish battery membership and AIO state; otherwise an identity-verified, existing AIO poll less than 30 seconds old can support scheduled Venus charging for a previously recognised single-AIO site. AIO discharge above 50 W blocks Venus charging to avoid draining it into Venus. Unknown or multiple-AIO membership cannot be replaced by one inverter's SOC. Multi-AIO sites retain the Gateway route. No site grid reading is fabricated from battery telemetry. Eco and export still require fresh site measurements; AIO grid/load readings have not been promoted to whole-site authority without hardware comparison.

Each battery observes its own scheduled target. Venus reaching target remains protected even if AIO is still finishing; it no longer reports this as absent import headroom. The established AIO lifecycle retains its own ownership and target/restoration. Scheduled recovery can use advancing Venus measurements with a still-valid cached AIO reading, without rearming a cancelled manual export.

Gateway collection now runs in the background using the established Giv client and Graceful Continuity. It collects grid/PV/load and unit SOC/power separately, retaining source timestamps and validating their age/skew, rather than requiring all topology and telemetry banks in one two-second transaction. Topology is refreshed separately; an identity/range failure invalidates the feed and learned membership. Command transport quiet windows defer Gateway work. Retry clients now preserve caller identity and queue policy. Diagnostics distinguish queue wait, connection time, response time, retry outcome and group age. Bounded summaries are saved privately under the existing shadow directory, without engineering controls added to the UI.

The shared AIO early-termination rounding helper now treats seconds/milliseconds just after :00/:30 correctly. Grace stays within the configured cap. Exact normal planned slot ends remain unextended. The new tests exercise this inherited helper through the actual managers.

## Transport differences

**Modbus:** five-second software command lease; charge cutoff 42011 is written and read back, including a changed target at unchanged power. Existing force-mode and power-register readbacks and recovery are retained. No undocumented timer registers or native schedule writes have been added. The [community register documentation](https://github.com/ViperRNMC/marstek_venus_modbus/blob/main/README.md) supports the existing force-control and target register family; this is provenance, not hardware certification.

**Local API:** the production two-second quiet interval remains. The policy issues an eight-second command-authority window so pacing does not consume the whole send budget; the battery-side Passive countdown is still capped at five seconds and bounded by the known slot end. Evidence admission remains six seconds, distinct from the transport lease. Identity discovery is refreshed every 30 seconds and accepted for at most 45 seconds; every reply remains checked against endpoint, request ID and bound source. Discovery no longer competes with every second power sample. Commissioning must prove paced renewal, both directions, measured stopping and native expiry. A policy revision prevents reusing an older API commissioning result. No Modbus certificate can qualify API control.

## Simulated qualification and its limits

Accelerated six-hour plant journeys drive the actual command adapters at two-second virtual steps for targets 70% and 100%, with Gateway unavailable throughout, then IOG window amendments, protection and Eco recovery. Separate localhost TCP/UDP tests exercise the actual Homebridge managers and established AIO acquisition/restoration, including early-termination Grace Period. The API also runs a real-wall-clock UDP test with production two-second pacing, a modelled 4.2-second response lag and five-second native expiry.

These tests establish software behaviour under explicit model assumptions. They do not establish physical charging efficiency, exact SOC rounding, firmware response delays, battery acceptance at high SOC or household/site limits. No simulator is represented as a hardware commissioning certificate.

Important remaining limitations:

- Native Venus schedule programming is **not** implemented or qualified here. Last night's app schedule is evidence for an independently operating native schedule, not proof of programmatic schedule writes. It must not compete with the GivHome hardware trial.
- Modbus has no qualified device-side command-expiry watchdog. If the Pi or Venus link fails, software cannot guarantee delivery of a stop at a tariff boundary. Verified native SOC cutoff limits charging by target; it does not prove an autonomous clock deadline. Tests must report stop-unconfirmed honestly. API native countdown addresses a different failure mode and must be physically checked.
- Cached single-AIO evidence can only substitute once that membership is learned during this process. A restart with no usable Gateway membership cannot assume a single-AIO site.
- Gateway loss during Eco/export stops assistance; it does not authorise an unvalidated inverter grid-meter fallback. That remains a hardware comparison question.

## Sequential hardware comparison

1. Preserve the currently running package, configuration, commissioning records and relevant state. Record candidate SHA256, Node/Homebridge versions, firmware, endpoint, power limit and battery SOC. Use the same Ethernet connection and 800/2,500 W selection for both.
2. Test Modbus first with Local API off. Resolve the overnight app schedule's ownership before the trial. Use existing connection/battery checks; do not manufacture qualification files.
3. Run the same bounded scenarios: ordinary load and oven/hob additions; IOG arrival, amendment, disappearance/Grace Period and normal end; target 70% with an AIO/Venus SOC imbalance; stale Gateway groups; stale AIO cache; operator Off; restart/reconciliation; return to Eco. Compare both individual SOC/power and site flow.
4. Confirm measured idle/stop before changing transport. Only then ask the owner to turn Local API on and install the API candidate. Run its separate commissioning at the documented SOC range, then repeat the scenarios. The two candidates must never command Venus concurrently.
5. The unattended overnight plus IOG gate is simulated for this iteration, as authorised. Retain the physical overnight gate for a later night; do not label it passed by simulation.
6. Compare acquisition and recovery latency, charging availability, unwanted discharge during protection, stopping/expiry, Eco return, AIO command delays, freshness gaps and user-visible responsiveness. Separate transport delivery from policy rejection. Prefer the simpler candidate if differences are not operationally meaningful.

Usability and scope: retain the explicit optional Marstek section and existing setup helpers. No new diagnostic settings, site-import budget controls or unrelated tiles. GivEnergy-only regression suites are required for both packages. No GitHub push, npm publication or live handover is part of this build task.
