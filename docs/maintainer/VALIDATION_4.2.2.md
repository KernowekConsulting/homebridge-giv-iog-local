# GivHome 4.2.2 release validation

This patch fixes repeated cleanup after Venus Local API observation expiry. One stop episode remains latched until fresh evidence passes the recovery gate. An already confirmed stop is accepted without requiring a redundant zero observation; unresolved stops and register-only stop confirmations still block new control until measured zero. Freshness, export ownership, commissioning and device limits remain enforced.

Three regression tests fail against the original v4.2.1 implementation and pass with this patch. They cover repeated timeouts after cleanup, fresh observations during a pending stop, and an already measured stop. The complete targeted suite passed 89 tests on Pi Node 24.22.1 before the local deployment. Limited subsequent field observation confirmed measured stops, fresh telemetry and automatic resumption of eligible household support. These observations do not establish formal hardware or paired resource qualification.

Public release validation additionally requires the full source suite, native HAP checks, dependency audit and packed-artifact checks. The trusted publishing workflow repeats its release checks and verifies the immutable tarball digest before publication. The project owner authorised push and stable publication on 19 November 2026.
