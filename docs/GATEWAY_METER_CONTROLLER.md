# Gateway-driven Marstek meter replacement — iteration 1

Private development build `4.1.3-marstek.2`, based on the 4.1.2 Homebridge baseline and the monitoring preview. Prepared 4 November 2026.

## Delivered

- `lib/marstek/gateway-meter.js`: read-only Gateway telemetry reader using our unchanged GivModbus framing/client, address 17 and FC04. Reads the three short banks demonstrated on the owner's installation. Checks response serial, function, range, word validity, collection span and topology. This is not a full energy-history decoder.
- `lib/marstek/meter-controller.js`: deterministic household-demand controller producing dry-run power requests. Positive output means Marstek AC discharge; negative means AC charging.
- `tools/gateway-meter-sim.js`: idealised closed-loop simulator with an expiring simulated actuator. Exports machine-readable time series.
- `tools/gateway-meter.test.js`: controller, Gateway decoding, convergence, fault and invariant tests.

No network writer, actuator binding, automatic live Gateway polling, HomeKit control tile or tariff automation is enabled. The existing Homebridge monitoring path remains as before. The Gateway reader can be called explicitly by a future shadow runner; this iteration is an executable controller component and simulator, not a deployed meter replacement.

## Two explicit behaviours

**Residual (default):** adjust Marstek to reduce measured site import or surplus export. If the AIO already covers the load and grid flow is zero, Marstek remains idle. This preserves AIO priority.

**House support:** include positive AIO discharge in the demand signal. As Marstek takes over household load, an Eco AIO can reduce its contribution. This is a selectable research policy, not an automatically selected clock schedule.

Both modes prevent Marstek discharge while the AIO is charging, and prevent Marstek charge while the AIO is discharging (above the activity deadband). This deliberately conservative interlock avoids transfers between batteries. It can also suppress useful behaviour in some mixed-flow conditions; later policy may distinguish deliberate forced actions from ordinary Eco response using verified action state. Power alone is not ownership evidence.

## Control law and inputs

Inputs are timestamped Gateway net grid power (positive export), AIO aggregate AC power (positive discharge), and explicitly direction-qualified Marstek **AC-side** power and SOC. Do not substitute Marstek DC battery watts for AC contribution. The existing E3 community decoder does not automatically satisfy the AC-direction qualification flag.

Residual error = negative grid export watts. House-support error adds positive AIO discharge watts. Candidate power = currently measured Marstek AC contribution + 0.5 × error, outside a 50 W deadband.

Apply directional permission gates, a default 20% reserve, 100% charge ceiling, configured charge/discharge limits (800 W discharge by default, up to 2500 W with existing-device-limit confirmation; charging separately defaults to 2500 W), and a 300 W/s ramp. Reversals pass through zero. Pause/reserve/interlock restrictions override the ramp immediately. A first request after startup or expired intent starts from zero.

Freshness defaults: both samples at most 3 seconds old, no future timestamps, at most 1 second mutual skew. New requests require both observations to advance; repeated timestamped frames neither ramp nor renew a lease. Missing, invalid, stale or out-of-order evidence produces a stop request. The Gateway bank collection span is bounded to 2 seconds and its snapshot is dated from the first request, not the last response.

The proposed lease is 5 seconds. **Only the simulated actuator implements that expiry here.** No claim is made that Marstek Modbus or Passive mode has this physically verified timeout/fallback. Stop requests in this iteration are data, not electrical device actions.

An advisory 6000 W export budget with 200 W headroom margin caps additional requested discharge based on the observed site state. It does not guarantee the site limit: AIO, PV, demand and communications can change after a measurement. This controller does not operate the AIO or provide a certified export limiter.

## Gateway mapping and topology

Uses the supplied GivHome mapping: IR1616 net grid export positive; IR1617 PV; IR1618 household load; IR1702 aggregate AIO raw negative discharge; IR1801–1803 SOC; IR1816–1818 per-AIO raw negative discharge.

The default `owner-enum` profile explicitly interprets the owner-provided topology setting 0/1/2 as 1/2/3 AIOs, and independently requires the online count to agree. A separate explicit `literal-count` option exists for other qualified profiles. This is not automatic firmware discovery or evidence that all Gateways encode IR1700 identically. Single-AIO evidence is from the actual owner capture; dual/triple enum cases are synthetic qualification fixtures.

## Reproduce

From this source directory, on Node 22 or 24:

```sh
npm run test:gateway-meter
npm run simulate:gateway-meter -- simulation.json
```

The new test command requires only Node's built-in modules. Simulations open no network connections and contact no equipment.

Six scenarios, including an explicitly commissioned higher-limit example: household import; solar surplus; Eco AIO with residual mode; Eco AIO with house-support mode; telemetry loss. The plant assumes instantaneous, lossless AC response at 1-second steps and a responsive Eco AIO. SOC is fixed at 60% for short convergence runs; separate tests cover reserve and ceiling gates. These assumptions intentionally exclude real latency, losses, SOC evolution, firmware watchdogs and competing-controller dynamics. They are not forecasts of physical performance.

## Physical qualification still required

Confirm Gateway measurement coverage and time behaviour; identify a stable Marstek AC power field and direction; qualify a meterless absolute-power command and independent command expiry. Then run a read-only shadow controller, compare its requested outputs with site behaviour, and add a separately guarded actuator before any live household regulation. Test controller interference and failure recovery on hardware before claiming autonomous self-consumption or coordinated export.
