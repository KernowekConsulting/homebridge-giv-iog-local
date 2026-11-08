# GivHome 4.1.3 validation

8 November 2026. Scope: the CE/AC upgrade regression reported by Iain Hancock, configuration migration and write-evidence wording.

The project owner requested fixes, validation and shipment. Stable publication is conditional on source, packed-package and native HomeKit checks passing. This record makes no new physical inverter validation, Pi resource qualification or automatic solar planning claim.

## Cause and implementation

Beta.4 added a shared action-acquisition check for an engineering acknowledgement already defined in beta.3. That blocked existing timed charge and IOG charge-mode protection before register writes. Version 4.1.2 removed the token but preserved the old boolean false, also the earlier settings-page default. The reported 4.1.2 error matches that path; Iain's saved JSON was not supplied, so its exact origin remains inferred.

4.1.3 retires both engineering settings at runtime and removes them on settings migration. Existing normal master/feature selections are retained. The master battery-control switch is now visible under Apple Home controls; an explicit false takes precedence over the old stage-11 alias. A saved legacy master choice is copied only when the canonical choice is absent. Fresh identity, model, firmware and register validation, action ownership and restore/readback safeguards remain mandatory. Migration itself sends no writes. Already-enabled automation may resume on upgrade; users retaining an opt-out must disable the master or relevant feature first. Do not delete recovery journals.

Charge 30m remains a regular timed tile, not a legacy-only accessory. Charge Target is a preference and does not start charging. No accessory identities or command durations change.

Write response logs distinguish payload submission, response bytes and pending readback. Reconciled records explicitly mark verified register readback and unverified physical flow. Response bytes are not presented as a validated protocol acknowledgement. No blind resend policy changes.

## Validation

Node 24.22.2, clean locked dependency installation, all 55 JavaScript files syntax-checked. Full source test command passes 421 tests across charge lifecycle/target, ownership, beta controls, observation, settings and CE/model suites. Native Homebridge/HAP tests pass 19 tests, including a real Charge 30m characteristic start/stop using simulated registers with an old false flag. Dependency audit reports zero vulnerabilities.

Regression tests cover both AC model codes 3001/3002 and missing/false/true old flags through manual start, restart, stop/restoration and IOG start/end/restoration. Tests also cover normal feature-off choices, master off, stale alias precedence, idempotent migration, and unsupported identity with zero writes. Existing failure/recovery, external-controller preservation, emergency stop and AIO/hybrid tests remain in the full suite. CE simulations fail on accidental socket connection.

The extracted packed package also passes all 421 source-suite tests and 19 native HomeKit tests. The runtime-bound qualification record matches the final source. The final tarball digest is frozen in the publishing workflow. Release publication uses an immutable tag and the reviewed tarball digest; GitHub Actions must rerun validation, audit and digest verification before npm publication. Public registry bytes and latest channel must then be checked independently.

A full physical lifecycle, charging power, IOG behavior on Iain's inverter and Node 26 compatibility are not established by these simulations. No inverter writes or local Homebridge installation are part of the release process.
