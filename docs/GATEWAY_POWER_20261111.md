# Restore authoritative Gateway power — 11 November 2026

Live export capture11:26:45 showed grid3675W export, per-unit AIO296W and Venus690W. The coordinator reduced proposed AIO from6000 to3111W because it inferred the unexplained difference was independent generation. Native AIO ownership consequently restored. This was not proof of target completion.

Our established gateway-meter.js decoder already uses signed IR1702 for whole-site AIO AC power. The new GatewayFeed instead summed IR1816–1818. That departed from the baseline and allowed lagging individual readings to drive the fast allocation loop. The owner's supplied Gen1 Gateway mapping explicitly distinguishes combined IR1702 from individual registers.

GatewayFeed now reads IR1700–1702 each collection and uses -signed(IR1702) as aioDischargeW, matching the established decoder. Individual unit values remain in units and individualAioDischargeW, never added to the combined total. Membership, meter, aggregate and unit timestamps must all be within the same existing6s freshness and2.5s skew limits. All three groups publish atomically. No device write/register mapping changes, no relaxed safety timeout, no GivEnergy-only UI or queue change.

The journal records both aggregate and summed individual AIO power and identifies IR1702 as the source. A regression reproduces a whole-site4000W/individual296W mismatch and verifies that the lagging unit value no longer causes the false external-generation calculation. Source suites and packed tests are retained for both transports.

An independently bounded HomeKit test on the Pi sends Off after40s even if the Mac locks, uses only the bridge's existing local authenticated interface, and yields if the user changes the requested action. No pairing, authentication or firewall settings are changed. Actual raw and aggregate power must be inspected after deployment; register-map correctness alone is not a full physical pass.
