# Local API beta.2 validation — 14 November 2026

Beta Marstek Addon. Not for public use

This opt-in beta carries the repaired Local API runtime. Existing Octopus polling and configured AIO polling intervals are retained. Marstek integration remains disabled by default; the stable npm channel is not changed.

## Evidence

- Runtime candidate r9: complete exact packaged Node 24 suite, 945 test invocations, zero failures or cancellations. The beta.2 label changes product/version metadata and release tooling, not the energy-control implementation.
- Renamed beta.2 runtime archive: complete packaged Node 24 suite, 945 test invocations, zero failures or cancellations, exit 0. The final publication tooling adds one passing scoped-approval regression; CI validates the complete final source and archive again before publishing.
- Existing native HomeKit release suite: 19 passed; dependency audit: zero vulnerabilities.
- Publication guard regression retains prior beta.1 authorization and adds a distinct beta.2 approval scoped to 14 November 2026. It rejects the stable channel, missing packaged validation, changed runtime hash, wrong scope/date and default-enabled integration.
- Physical Charge To on this runtime family measured AIO charging around 5.8 kW and Venus around 0.47–0.53 kW. Off/restoration were checked.
- Physical Export To on r8 automatically completed at 64.899% against a 65% combined target. Subsequent Gateway evidence showed AIO output around 359 W and net export around 97 W after Eco restoration. No native action owner remained. Material Venus assistance during that export was not established.
- Physical Venus commissioning separately proved both directions at 100 W, measured stops and native expiry, bound to the same identified hardware/configuration.
- r9 live combined-SOC check: all 12 read-only samples over 96 seconds succeeded for the separate AIO, Venus and combined Battery SOC tiles. All 220 installed package files matched their manifest.

## Scope

Recovery reads are no longer permanently starved after expired continuity. Observation continues during bounded command delivery. Only the latest queued proposal survives, and a revoked proposal cannot replay. Activation uses bounded readback settling; uncertain enables are neutralised with an ownership witness while preserving genuinely changed external control windows. Combined-SOC display can use independently verified component SOC with their original timestamps, without changing control evidence or polling.

The unattended physical overnight run and real IOG-transition validation remain outstanding. Simulated night and amended IOG transitions are not described as physical field passes. No paired 72-hour resource qualification is claimed. Hardware receipts and private operational logs are retained outside the published repository/package.
