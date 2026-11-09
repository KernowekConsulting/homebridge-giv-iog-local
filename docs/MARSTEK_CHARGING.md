> Historical private-preview engineering record. For current optional setup and scope, see [Optional Venus information](VENUS_OPTIONAL.md).

# Marstek overnight and IOG charging preview

Private build **4.1.3-marstek.3**, based on GivHome **4.1.2**. This is a software qualification preview. It reads devices and records proposed AC power; it has no Marstek write transport or command hook. The separate GivEnergy controller retains its existing behaviour. No changes have been deployed to the Pi.

## Everyday behaviour

- Cheap Overnight proposes charging the selected Venus to the existing effective Night Target, normally 100%. A lower Night Target is honoured. If the existing solar-aware feature is enabled and supplies a lower effective target, the preview follows that existing choice too.
- IOG protection uses the existing IOG mode and independent IOG charge target, not the Night Target. Overnight takes precedence when both windows overlap. Outside overnight, stale Octopus information holds proposals at zero.
- Reaching a target protects the battery for the remainder of that occurrence. A later higher target permits more charging. This completion memory is currently in-process; it is not recovered after restart.
- AIO discharge above 50 W holds Venus charging proposals at zero. This avoids deliberately charging Venus from an AIO that is supplying the AC bus. It can delay charging until the AIO is charging or paused.
- Existing occurrence cancellation, Emergency Stop state and the new Marstek automation hold suppress proposals. They do not stop physical Marstek equipment in this preview. After a charge window, the existing Gateway household-support policy takes over.
- Charging and discharge ceilings are independent. Simulations default to 2,500 W input and 800 W output. Raising output requires confirmation of an already commissioned device limit; the plugin does not unlock it.

The existing AIO SOC tile is unchanged. Venus gets separate read-only monitoring accessories. Capacity-weighted combined SOC and cross-battery allocation for the general configured Charge target are not implemented. Storm and Holiday modes remain design ideas.

## Sampling and UI

Marstek Integration remains the last section of Plugin Config. The UI also presents a Gateway connection check above the schema form, using the standard Homebridge custom-UI API. It reads the configured Gateway through the existing GivModbus client at port 8899/unit 17 and rejects a different response serial. IP and expected serial are distinct from the AIO configuration. Serial matching is an identity cross-check, not authentication.

The connection report omits IP and serial on download. Changes invalidate a report, including changes while a request is pending. Nothing is saved to the live bridge by testing a connection. The standard Save action retains normal Homebridge ownership of configuration changes.

New devices default to polling every **2 seconds**, with a 1-second minimum. Existing explicitly saved intervals are retained. Shadow mode accepts 1–5 seconds and uses one coordinator for the selected Venus; other Venus monitors remain independent. It reads the Gateway and Venus in parallel, serialises each endpoint's reads, and never overlaps cycles even when one endpoint fails early. Three-second collection timeout; no late result can revive a timed-out proposal. Freshness limit is six seconds, maximum endpoint skew 2.5 seconds, proposed lease seven seconds or the charge-window end, whichever is sooner. These are initial software settings to tune with observed hardware timings.

Gateway topology defaults to the owner's confirmed encoding: 0=single, 1=pair, 2=triple. Online count remains literal. All configured AIOs must be online. The owner-enum profile must be checked on other Gateway firmware; it is not inferred universally.

## Enable shadow observations after installation

1. Add the Venus IP, stable permanent ID and verified Modbus port/unit. Check monitoring against the Marstek app.
2. Enter the Gateway IP and expected serial. Test from the Pi/Homebridge network, particularly when the Mac VPN interferes with local routes.
3. Verify the signed Venus AC reading during real charging and discharge. Until the direction selector is changed from **Not yet verified**, proposals remain stopped.
4. Select the same permanent battery ID for shadow planning and enable the read-only shadow controller. Use 1–5 second polling, initially the 2-second default. A missing enabled battery ID is logged explicitly.
5. Keep the existing Cheap Overnight hours, Night Target and IOG preferences as intended. Installation time zone defaults to Europe/London and handles UK daylight-saving changes. The existing IOG integration must already be configured and fetching fresh dispatches; the Marstek preview does not create another Octopus poller.

The latest proposal is stored atomically in `givhome-marstek-shadow/<battery-id>.json` beneath Homebridge storage. This bounded file contains device identity, sequence, time and proposal. Corruption or identity mismatch prevents shadow startup; the file is not silently overwritten. Restart recovers the sequence only and never replays old intent. It is a proposal journal, not durable actuation ownership or confirmed physical state.

## Simulation results

The synthetic plant includes 5.12 kWh capacity, 92% charging efficiency, 94% discharge efficiency, one-second telemetry lag, one-second command delay, a three-second power response and charge taper above 95%. AIO charging is assumed during the cheap period. Lease expiry and sequence rejection are explicitly simulated device behaviours, not established Marstek features.

| Scenario | Model result |
|---|---|
| Start 20%, target 100% | About 2 h 02 min to target; 4.45 kWh AC input |
| Start 20%, Night Target 70% | About 1 h 07 min; 2.79 kWh AC input; ends about 70.05% |
| 30-minute IOG slot, start 20% | About 1.24 kWh AC input; target not reached |
| Lost readings for one minute | Proposal expires; recovery permits a new charge ramp |
| Repeated or eight-second-old readings | No continuing charge proposal |

At 2.5 kW, the ideal empty-to-full energy calculation is 5.12/2.5 = 2.048 hours. Losses, taper, temperature, device limits and available import capacity increase actual time. The earlier 6.4-hour calculation used 800 W output; it is not a charging specification.

Reproduce with `npm run simulate:charging -- report.json`. Run `npm test` and `npm run test:hap` under supported Node 22 and 24. The real TCP integration test uses production GivModbus and Venus readers against loopback servers; it asserts Gateway FC04 and Venus FC03 traffic only. UI checks use a disposable standalone Homebridge UI on loopback, not a second running bridge.

## What remains for installation

Confirm model/register scales, actual AC direction, permitted charging power, commissioned discharge limit and request-to-observed-power timing. Then qualify the selected command path, ownership, manual intervention and what the device really does when communication stops or the controller restarts. The included verification helper rejects an ACK without matching fresh measured power, but no physical actuator uses it yet.

A physical writer, proven device watchdog/expiry and safe recovery must precede automatic charging. The shared 6 kW export limit is not enforced by this preview; a site import budget for simultaneous EV/AIO/Venus charging is also not implemented. Native Marstek meter impersonation is not implemented: this is Gateway-driven external power planning. Testing the coordinated AIO response and battery-to-battery transfer is still required. These limits cannot be qualified through simulation alone.

## Validation record — 4 November 2026

The default regression command passed **488 test-runner cases** on Node 22.23.4 and Node 24.22.2, including 30 charging/service cases and nine Marstek configuration/UI cases. The separate original native HomeKit suite passed **18 cases per runtime**. Existing release, forecast and documentation checks also passed. Repeated runtime runs are not additional unique cases.

The actual Homebridge Config UI X 5.30.0 renderer was exercised using an isolated Mac loopback profile: the bottom Marstek section and shadow fields rendered, the connection button accepted the simulated expected serial and rejected a mismatched serial. The lab tab was closed without saving and temporary UI/simulator servers were stopped. The established 4.1.2 source checkout remains clean and the Pi has not been changed.
