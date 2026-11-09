# 4.2.0-beta.1 validation and publication scope

9 November 2026. The project owner authorised GitHub and npm publication after all checks pass. This authorisation is specific to the commissioning-enabled Marstek beta; it does not authorise stable/latest promotion or claim physical hardware validation.

- Complete source suite: 662 tests pass on Node 22.23.4 and 24.22.1.
- Native HomeKit command suite and extracted-package suite are required before publication; final receipts are retained in the household resource library and CI run.
- Existing GivEnergy behaviour is based on 4.1.3; optional Marstek setup defaults off.
- A fresh, matching commissioning record is required for physical Venus control. The web UI provides read-only connection checks and supervised 100 W charge/discharge/stop checks, cancellation, prestate restoration and interrupted-check recovery.
- Device identity is decoded from the community map's six ASCII MAC registers and bound to firmware, configured endpoints and limits. No official manufacturer Modbus guarantee is claimed.
- Runtime qualification hashing covers nested Marstek code, UI backend/public scripts, schema, package identity and publication guard. The beta publication decision is version/channel scoped and rejects changed runtime, missing simulation evidence, default-enabled Marstek or a physical-validation claim.
- Source and protocol tests use loopback servers, synthetic plants and AIO register fixtures. No new live AIO/Gateway/Venus control is claimed. Resource budgets and a device-side watchdog remain unqualified.
- Public replay fixtures are anonymised derivatives: dates shifted, powers rounded to 10 W, SOC rounded to 5%. They are not raw household traces. Private originals remain in the evidence library.
- The pre-existing solar observation foundation remains unqualified for automatic control; that boundary is not relaxed by this release.

The npm dist-tag is beta. The latest channel must remain 4.1.3. The GitHub release is a prerelease, with release body exactly: Beta Marstek Addon. Not for public use
