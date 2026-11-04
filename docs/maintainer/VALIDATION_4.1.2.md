# GivHome 4.1.2 validation

4 November 2026. Scope: simplifying supported single-phase AC-coupled confirmations and separating model capabilities.

The project owner authorised build, push and stable publication conditional on simulation passing. This is a simulation-validated control patch, not new physical inverter validation or a measured resource qualification. Existing 4.1.0/4.1.1 field evidence remains historical evidence only.

## Implementation

Both 3001 and 3002 single-phase AC models use the existing core route without the engineering token. Explicit false remains an opt-out. Fresh responder serial, model and firmware checks run at acquisition and recovery; normal register reads reject mismatched responders. Slots, pause mode, pause timing and command power/additional AC limits are separate capability fields.

Only known AC, AIO and existing 2001/2002/2003 hybrid profiles are enabled. Hybrid firmware century 3 uses extended slots above 302; other established hybrid generations retain two slots. Optional pause is not inferred from a configuration checkbox. Legacy owned pause cleanup still requires readback. Supported identity is persisted in the existing version-1 control journal so extended recurring schedules remain recoverable across restart. Fresh identity is rechecked before mutation.

The patch also removes a CH-specific one-off-slot assumption from extended hybrid Emergency Stop recovery. It retains journal ownership, external-controller change preservation, exact restoration and no-blind-resend recovery. Disabling new controls does not strand an already owned action's cleanup.

## Validation scope

The suite drives production automation, command, ownership, stop and recovery functions with simulated register transports. No real inverter is contacted. Both AC model codes are exercised in all four IOG modes at 5.2, 9.5, 19 and 38 kWh configured capacities, through start, restart and restoration. Tests cover interrupted starts/restoration, invalid identities/firmware/registers, unsupported families, missing pause capability, extended schedules and independence of AC ceilings from command power. Native Homebridge accessory tests are also required.

Source and packed-package checks, syntax, audit, matched qualification record and byte-identical publication verification are recorded in the external release evidence. No Pi or inverter deployment is part of this release. Physical battery power, firmware-specific timing, new battery combinations and a complete physical lifecycle on Iain's inverter remain untested. Formal paired Pi resource budgets are not claimed; automatic solar planning remains disabled.
