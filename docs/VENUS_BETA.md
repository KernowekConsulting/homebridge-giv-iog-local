# Connect your Venus

Marstek support is optional. If you do not have a Venus, leave Marstek Integration off and carry on using GivHome as before.

## One-time setup

1. Open **Marstek Integration** at the bottom of GivHome settings in Homebridge's web UI.
2. Enter the Gateway IP and its GW serial. Add the Venus IP and choose **800 W** or **2.5 kW** to match the limit configured on the battery. Reserve the Venus IP in your router's DHCP settings so it stays the same. GivHome does not change that device power setting.
3. Select **Enable battery control** if you want GivHome to manage Venus. Save and restart Homebridge, then reopen the settings page.
4. Under **Connect your Venus**, choose **Check connections**. This checks the configured Gateway and reads the Venus identity and firmware. A connection check does not start a power test. Pause an active GivHome Venus action before running it.
5. Choose **Run battery check** when the Venus is idle and between 25% and 90% charged. Pause other Venus schedules/controllers in its app first. GivHome briefly requests 100 W charge, checks measured response and stopping, then does the same for discharge. It restores and verifies the previous idle settings before saving a successful result. **Cancel** stops the check; no later test step is resumed automatically.

When the page says **Ready**, GivHome can use your selected controls. The result is retained across restarts. You do not need another beta simply to complete commissioning. A different battery identity, firmware, Gateway binding or configured power ceiling requires the checks again. Unsupported or ambiguous device behaviour remains blocked and may need further investigation; the setup check does not guarantee every firmware will work.

The helpers run in Homebridge itself. Its web page starts checks and shows progress; there is no desktop application, terminal requirement or extra commissioning tile in Apple Home. Saved settings and a running Homebridge instance are required. The UI refuses checks using unsaved edits or an old runtime configuration.

## Everyday use

The AIO keeps its direct GivEnergy connection. The Gateway supplies identity-checked household readings, and Venus has its own Modbus connection. Gateway access is read-only.

Combined SOC is weighted by supported model capacity and valid Gateway membership: 13.5 kWh per AIO and 5.12 kWh for Venus E. The Marstek section does not ask for duplicate capacity or time-zone settings. Overnight charging follows the Homebridge clock used by existing GivEnergy schedules.

There is no import-budget field or mandatory whole-house import setting. Charging uses the configured battery power ceilings; this is not a whole-house import limiter. Previously configured optional import allowances are retained for compatibility.

**Pause Venus automation** pauses Venus plans and cancels an active combined Charge To or Export To request. Targets remain saved and monitoring continues. Independent GivEnergy schedules are not paused. As with other settings, save and restart to apply a configuration change.

## What setup establishes

The check binds a stable device identifier decoded from the six ASCII MAC-address registers in the community map, model and firmware to the configured endpoints and expected Gateway serial. It checks small-power charge/discharge direction, two measured idle confirmations after stopping, and original idle-control readback. It does not change the grid standard, power-version setting, app schedules or device firmware. Higher-rate performance and installation suitability are not established by a 100 W test.

During setup, normal coordinated actions are suspended. Interrupted checks are recovered to the recorded idle prestate only after the same identity is confirmed. A failed or cancelled check does not save a new commissioning result. Unknown identity or unconfirmed stopping is shown as **Check needed**. Normal controlled actions keep a recovery checkpoint; a matching commissioned battery is reconciled after restart before new activation. Unrelated external force control is not automatically overwritten.

A commissioning result does not prove the Gateway covers every electrical branch, or enforce a hard 6 kW export limit. That wiring boundary needs installation confirmation. The existing AIO/PV export-limit caveat remains. Software can request Pause on lost evidence while it is running and connected; no claim is made that a stopped Pi or unreachable battery can deliver that command. A device-side watchdog is still unqualified.

The module's Modbus identity/control registers are informed by the partially validated ViperRNMC Venus E v3 map. Passing the checks validates the tested behaviours for this device/firmware; it does not turn that map into an official manufacturer guarantee.
