# Bringing your Venus into GivHome

GivHome’s Venus integration is a preview. Keep your existing GivEnergy setup as it is while we check the new battery. Start by reading its status; enable control only after the checks below have passed on the installed unit.

## Before you begin

Have the Venus model, firmware version and local IP address to hand. In GivHome, enter the Gateway IP address and confirm its serial number matches the label or your existing GivEnergy app. Give the Venus a clear name. Check that the network addresses remain stable.

Keep the Venus at its installed, approved power limit. The reported 800 W setting is our starting assumption, not permission to raise it. Confirm the unit’s actual charge and discharge limits independently; they need not be the same.

## First connection: observe

1. Confirm GivHome has found the intended Gateway and Venus. A reachable address alone is not enough to identify a battery.
2. Compare each battery’s SOC with its own app. Combined SOC should reflect their configured usable capacities, rather than a simple average when capacities differ.
3. With no GivHome command active, observe charging, house supply and idle periods. Confirm the reported direction of power for each unit and the Gateway’s net import/export.
4. Check timestamps and interruptions. Missing readings must show as unavailable, rather than silently retaining an old value.

## First controlled trial

Do this while someone is present and can stop the test. First qualify a small, bounded Venus command and verify the unit’s own timeout or stop behaviour. The current software remains a shadow planner; passing this checklist does not itself enable device writes.

Then try a nearby Charge To target, cancel it, and repeat to automatic completion. Check the device’s own readings as well as the Home tile. Repeat with a nearby Export To target above each battery’s reserve. Confirm that switching one action on replaces the other, and that switching Off stops it.

Disconnect the control connection during a bounded trial and verify the battery returns to its commissioned safe behaviour. Restart GivHome and confirm an interrupted manual action does not restart by itself. Do not assume software can send Stop after the network has failed: the device timeout must be proven.

## Add everyday charging

Check the Night Target, overnight window and IOG target with a small trial before leaving them unattended. Confirm the site import allowance includes the EV and house load, and that the AIO and Venus do not repeatedly charge one another. Compare Gateway readings with the batteries’ own apps.

## Add export assistance last

Keep the 6 kW site export allowance and an operating margin. Establish how the AIO responds to a Venus contribution before trying to fill export headroom. Test house load falling and PV returning. Stopping Venus cannot guarantee the site limit if AIO or PV output alone exceeds it; a qualified site-wide response is still required.

## Ready for everyday use

Record the tested firmware, supported controls, limits, reserves and stop behaviour. Proceed only when device feedback, automatic completion, unavailable-data handling and Home updates agree. If a check fails, return to observation and keep the existing GivEnergy controls in charge.
