# Gateway continuity: next investigation

8 November 2026. Read-only investigation; no live settings changed.

## Finding from the current implementation

The recorder and `gateway-meter.js` disable the established GivModbus Graceful Continuity path. The recorder then backs off after unsuccessful cycles. The snapshot reader accepts at most two seconds of bank acquisition, and the shadow service stops and discards that collection after three seconds. The established Graceful read budget can exceed both limits.

Consequently the recorded single-attempt success percentage is not a measurement of the mature inverter continuity experience. Nor is the fraction passing the chosen freshness budget an intrinsic reliability rating for the Gateway. It describes this collector, these limits and this observed period. The small 6 November interleaved comparison failed qualification and cannot establish that Graceful is ineffective.

## What to compare

Use one read-only acquisition owner and the installed, proven YY-framed transport. Preserve response identity, function, register-range and clock checks. Compare current collection, per-bank Graceful and fresh whole-snapshot Graceful, with bounded attempts and explicit partial-read disposal. Measure failed attempts, eventual coherent recovery, age of accepted readings, gaps at the consuming controller and request load separately.

The critical design question is whether acquisition recovery should run independently of the controller's short decision deadline. A controller can stop on expired data while acquisition keeps making bounded recovery attempts; a newly acquired coherent reading can then be assessed on its own age. This does not permit an old reading to renew a lease, combine banks of incompatible ages, or silently restart a cancelled manual action. Successful fresh reads and an authorized action remain separate conditions.

## Offline cases before a further Pi trial

- First attempt fails, a fresh opportunity succeeds within the decision deadline.
- Several attempts fail; a coherent fresh snapshot arrives after the old collection deadline. Verify the controller stayed stopped during the gap and define explicit recovery ownership.
- One bank succeeds but a later bank stalls. Discard the partial set before a whole-snapshot retry.
- Heartbeats, unrelated or wrong-identity frames arrive before the matching response.
- Device remains unreachable. Keep acquisition bounded and non-overlapping; do not create a retry storm.
- Wall clock changes, restart or cancellation occurs during recovery. Fence late results and retain saved targets without reviving the action.

A subsequent Pi comparison should pause only the observer, record that deliberate gap, restore it automatically and retain the existing inverter controller. Use more than two rounds across representative conditions before selecting a policy. Hardware/network symptoms remain evidence to correlate, rather than an assumed root cause.
