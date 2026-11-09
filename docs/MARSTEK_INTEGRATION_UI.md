> Historical private-preview engineering record. For current optional setup and scope, see [Optional Venus information](VENUS_OPTIONAL.md).

> Historical iteration .2 record. Iteration .3 now adds a real read-only Gateway connection test, optional shadow polling and charging policies. See [current behaviour](MARSTEK_CHARGING.md). The original limits and simulations below remain useful; statements about unavailable UI testing or diagnostics describe .2.

# Marstek Integration UI — 800 W correction

Private preview 4.1.3-marstek.2, based on GivHome Homebridge 4.1.2. No changes deployed to the live Pi.

The final collapsed section of Plugin Config is **Marstek Integration**, using the established Homebridge schema renderer and custom UI wrapper.

| Group | Fields | Current effect |
|---|---|---|
| GivEnergy Gateway | Gateway IP; expected GW serial | Saved identity-checked measurement source. Explicit reader calls compare response serial. No automatic polling. |
| Each Venus | Monitoring enabled; permanent ID; name; IP | Existing read-only monitoring |
| Each Venus | Discharge ceiling; higher-limit confirmation; charging ceiling | Validated simulation limits; do not change device settings |
| Connection and readings | Port; unit; polling; expiry; timeout; activity threshold | Existing monitor settings, grouped under an expandable panel |
| Controller preview | Residual demand / house support; minimum battery level | Saved simulation policy; no live controller |

Gateway fields can both be blank for monitoring-only use. If either is supplied, both must be valid. Gateway IP is separate from the AIO host. The serial is an expected-device identity check, not a cryptographic checksum or authentication mechanism. The reader rejects a mismatched response serial. There is no live connection test button or verified-connection status yet.

## Power ceilings

The earlier 1,163 W Marstek / 37 W AIO example assumed a 2,500 W discharge ceiling. Default output is normally 800 W. This preview now defaults the controller and new battery configurations to **800 W discharge**. A larger ceiling requires an explicit confirmation that the higher limit is already commissioned on the battery. This records the declaration; it does not independently verify, unlock or change the device limit.

Charging is independent: simulations retain a 2,500 W charging ceiling, subject to actual commissioning. The 800 W output default is not interpreted as an input-power specification.

| 1,200 W load scenario | Marstek discharge | AIO discharge | Grid import |
|---|---:|---:|---:|
| Default residual, no AIO support | 800 W | 0 W | 400 W |
| Default residual, Eco AIO | 0 W | 1,200 W | 0 W |
| Default house support, Eco AIO | 800 W | 400 W | 0 W |
| Explicit commissioned higher ceiling, house support | 1,163 W | 37 W | 0 W |

These simulations assume immediate lossless AC tracking and a responsive Eco AIO. They do not qualify physical expiry, control response or export-limit compliance.

## Reproduce saved policy

```sh
npm run simulate:gateway-meter -- simulation.json examples/marstek-controller-preview.json garage-venus
```

The option builder selects one enabled battery by permanent ID and uses that battery's limits. It does not independently regulate multiple batteries against the same site error. Gateway fields do not cause network access during simulation. Without a config argument the simulator emits the standard scenarios plus a labelled higher-limit example.

## Validation

Tests cover bottom UI placement, field exposure, optional paired Gateway inputs, response identity mismatch, 800 W defaults, higher-limit gating, preserved migration and saved-policy propagation. Existing GivEnergy schema defaults remain protected by their original contract hash. Full results are delivered alongside the package.

The actual Homebridge form has not been visually exercised with this preview. No live UI installation or save was performed on the user's bridge. Live Marstek control remains absent.
