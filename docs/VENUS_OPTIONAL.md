> Historical preview record. For the commissioning-enabled beta.1 setup and current scope, see [Connect your Venus](VENUS_BETA.md).

# Optional Marstek Venus addition

GivHome continues to work with GivEnergy alone. No Venus setup is required. Leave **I have a Marstek Venus battery** off unless you are adding one. The familiar GivEnergy controls and saved preferences remain the default.

If you add a Venus, open the final Marstek section and enable the option. Enter the battery connection and your Gateway IP/serial. Existing preview configurations with Venus devices are recognised during migration. Gateway connection checks are hidden for GivEnergy-only users. Advanced planning and connection settings remain inside the optional section.

This private build is still a **read-only/shadow preview**. Its new percentage tiles propose actions; they do not operate physical batteries. The descriptions say so explicitly. Physical support will require installation checks before release.

## Ordinary user experience

The normal questions should be: is the battery available; what is its level; what target did I choose; and is it working, waiting, completed or needing attention? Raw registers, owner generations and recovery journals belong in diagnostic evidence, not routine screens. This iteration does not add a technical dashboard. A fuller plain-language status presentation remains future usability work.

## Limits belong to the installation

The coordinator now uses the existing configured permitted grid export and separate AIO charging/discharging capabilities, selected Venus input/output limits, per-battery capacities/reserves and site import allowance. It does not assume every household has a 6 kW agreement. Defaults are starting values, not verified equipment capability. An output above 800 W still requires confirmation of an already commissioned Venus limit; nothing unlocks the device. The existing 200 W planning margin and 15-second near-reserve taper are internal preview assumptions, not installation permissions.

## Timing and cooperation

IOG uses the configured freshness allowance rather than a fixed two-minute boundary. Recognised, active Cheap Overnight and IOG charge owners can cooperate: AIO ownership is preserved, observed AIO consumption stays in the site import calculation and Venus receives only remaining allowance. Unknown, manual or transitional charge owners still hold the preview. This softens coordination, not write authority; there are no new physical writes.

## Identity and recovery

Minimum available core: expected Gateway serial, selected permanent Venus ID and Venus E3 profile. Name, IP address, polling settings and capacities do not define identity. Earlier private-preview identities can migrate when the core matches, preserving recovery holds and never replaying actions. A changed core is rejected.

The permanent Venus ID is user-configured, not a verified hardware serial. Hardware-level Venus identity remains an installation qualification gate; this build does not claim to detect a replacement battery at the same endpoint. A verified vendor serial or stable device identifier should be incorporated only once the actual interface is confirmed.

## Value retained from Graceful

Reviewed the established 4.1.2 DirectLocalReadOnlyClient gracefulContinuityRead and stage5-live-write-harness connectSocketWithPreSendContinuity. They demonstrate bounded read opportunities and keeping retryable pre-send connection failures distinct from uncertain post-send outcomes. Their complete retry budget is not copied into the short site snapshot deadline. Old values can remain visible during brief read trouble, but freshness gates still prevent new power proposals from stale data.

Repeated identical holds and already-cancelled targets no longer rewrite their journals. Latest-plan diagnostics checkpoint on meaningful decision changes or a one-minute heartbeat; live UI state remains in memory. Ownership acquisition, cancellation and recovery transitions remain immediate atomic commits, not delayed writes. This is an application of continuity and low-noise operation, not a claim that the original Graceful network mechanism itself provided persistence deduplication.

## Validation and next steps

All earlier native dimmer, ownership, household, transport and simulation suites remain included. New tests cover freshness, cooperative import accounting, installation-specific limits, stable identity/migration, idempotent persistence and opt-in UI/migration. Actual Homebridge and Apple Home visual behaviour still merits a disposable Test Home before adoption; simulation is not a substitute for that final usability check. No Test Home or live bridge has been configured by this work. No actual browser-render test is claimed for these new gating changes.

Historical engineering reports are retained under maintainer documentation and in the private household resource library. They describe prior iterations, not required reading for GivEnergy-only users.

## Percentage controls — usability revision .9

The three tile names are **Combined SOC**, **Charge To** and **Export To**. Combined SOC is the observed combined battery level; the other percentages are saved action targets. Stable accessory identities and pairing are preserved. A one-time name revision updates existing preview accessories, although Apple Home may retain a user-customised name.

When an action is Off, changing its percentage saves the target without arming it. Switch On to start. When that same action is already On, changing the percentage revokes its old token and starts a new request for the new target while keeping it On. Editing the inactive tile leaves the other action running. Off cancels the active request. Repeated echoes of the same percentage are ignored. Stale telemetry prevents a retarget from resuming an action; restart restores targets but leaves interrupted actions held.

These are shadow actions only. This is a usability change from earlier previews that required Off/On after every target edit. Tests exercise both On/percentage orderings; actual Apple Home behaviour is being checked in a separate Mac Test Home. The UI rig uses fixed simulator readings and cannot demonstrate SOC progression. No physical command path is enabled.

## Responsive Test Home

For the isolated responsive simulator and plain-language preview feedback, see [Responsive Test Home](RESPONSIVE_TEST_HOME.md). Physical battery actions remain disabled.
