# Separate native AIO and Venus continuity — 11 November 2026

The running-site evidence confirms that compact and standard Gateway pages both work in isolation (6/6 each), while brief gaps during normal operation keep interrupting a native AIO schedule. Treating the native AIO lifecycle as a Venus-style short setpoint lease needlessly discards the already verified AIO action. The established AIO retains its native schedule, target/reserve, power setting and clock expiry independently of telemetry polling.

Venus still stops on unavailable or stale Gateway evidence. A fully acquired/readback-verified AIO percentage action may retain its existing native setting, without new writes or power increases, for at most30s from the last qualified source timestamp. Repeated failed or pending samples cannot renew that deadline. The bound is also clipped to the original request/native schedule end. No unqualified or new native action is admitted by a display cache or continuation. Existing site-data6s freshness/2.5s skew requirements still govern new control admission and recovery pairs.

Off revokes continuation permission synchronously before asynchronous restoration. IOG arrival or stale Octopus evidence, emergency/operator hold, changed ownership, known membership/identity change and expiry end continuation. A250ms watchdog checks the bound and live vetoes without waiting for another hardware poll. Stop/restoration uses the existing ownership-checked queue; unresolved stopping remains a hard fault. Three advancing fresh pairs over six seconds are still required for a pending request to resume normal planning. At most the original pending request window remains; no manual request deadline is extended.

This is a software continuation bound. It cannot issue a stop if the Pi/link is unavailable; the existing native inverter clock/reserve remains the physical fallback. This does not claim a new independent site export-cap limiter for external generation during lost telemetry. Venus assistance remains stopped in that case.

On restart, matching saved Marstek Charge To/Export To owners are reconciled and restored through the established prestate/readback lifecycle. New manual intent is discarded. Normal Eco may recover only after verified cleanup and fresh evidence. Unrelated source owners are not adopted. No changes to ordinary GivEnergy-only command methods or schedules.

Gateway whole-site power remains IR1702, with individual unit readings retained separately. Acquisition retains the established grid-then-AIO-then-unit read order to avoid using an older AIO contribution against a newer grid reading during a ramp. Snapshots remain atomic.

The status helper correctly labels Eco waiting for a fresh pair as Eco, rather than inferring export from positive power. No new tile, setting or engineering field is exposed.

Both TCP and API journey fixtures now use production-style non-blocking AIO callbacks and the native continuation policy; asynchronous Off tests wait for and verify physical simulator restoration. Separate tests cover hard vetoes, source timestamp ageing, no timer renewal, watchdog expiry without another poll, queue-safe expiry, membership, restart and non-ownership. The isolated comparison data and prior physical outcomes are retained; passing simulation is not a claim of an unattended hardware overnight or IOG trial.
