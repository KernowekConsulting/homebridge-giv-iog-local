> Historical private-preview engineering record. For current optional setup and scope, see [Optional Venus information](VENUS_OPTIONAL.md).

# Marstek Venus E 3.0 MVP preview

Private build `4.1.3-marstek.0`, based on GivHome **4.1.2**, prepared 4 November 2026.

This preview adds optional local Venus E 3.0 monitoring to the existing GivHome Homebridge platform. Home Assistant is not required. The Venus has not yet been installed, so every Marstek result so far is simulated or a software test. No model/firmware combination is hardware-qualified by this project yet.

## What works in this preview

- Direct standard Modbus TCP reads, normally port 502 and unit 1.
- Up to four explicitly configured batteries, each with an independent monitor and stable Apple Home identity. This supports adding one or two Venus units alongside the existing GivEnergy installation.
- Battery level tile, battery status, temperature, charging and discharging activity.
- Custom read-only charge power, discharge power and AC voltage characteristics for compatible HomeKit apps. These custom fields are not promised as native Apple Home tiles or Eve history graphs.
- Firmware register values in diagnostics and the accessory information service.
- Connection timeouts, bounded reconnection delay, serialised reads, fragmented-frame handling, frame validation and rejection of partial/implausible samples.
- Last good observations retained through short dropouts, without changing their observation timestamp. After the configured age they become unavailable rather than reporting fresh zero power. Getter reads also check age, independently of the next poll.
- A local simulator, a read-only diagnostic tool and automated transport/native HomeKit tests.

Marstek reads have their own transport and cache namespace. Existing GivEnergy controls, tariff logic, accessory identity recipes and model qualification routes remain on the 4.1.2 baseline. An empty Marstek list starts no Marstek connections.

## Explicit feature boundary

The transport implements **FC03 reads only**. It has no write or arbitrary-request interface. There are no Marstek charge/export controls, IOG protection, Night Target enforcement, schedule writes, Emergency Stop, shared export coordination or automated mode changes in this preview. Existing GivEnergy Emergency Stop does not stop a Venus.

This preview does not enforce a combined site export limit. Connecting another autonomous battery can change site power flows even while GivHome only monitors it. Multi-inverter export must be commissioned separately before enabling concurrent export. A fixed timetable is not a site export limiter.

No Marstek readings are added to the existing Solar, Grid Import or Grid Export histories: device AC flow is not whole-home grid flow. No combined SOC, usable capacity or battery runtime is inferred.

## Setup

Use Node 22 or 24, matching GivHome's existing requirement. Keep a configuration backup. The installable tarball is a private development preview; it has not been published to npm or deployed to the live bridge.

In Homebridge's GivHome settings, open **Marstek Venus E 3.0 — preview**, then add a battery. Existing GivEnergy configuration stays in place. Example additional configuration:

```json
{
  "marstekDevices": [
    {
      "id": "garage-venus",
      "name": "Garage Venus",
      "host": "192.0.2.50",
      "port": 502,
      "unitId": 1,
      "pollIntervalSeconds": 30,
      "staleAfterSeconds": 90,
      "timeoutMs": 3000,
      "thresholdW": 50
    }
  ]
}
```

`192.0.2.50` is an example, not a discovered device. Replace it after installation. Wired Ethernet is the initial qualification target; Wi-Fi access is not guaranteed by this preview. Configure a DHCP reservation where practical. API enablement or Modbus availability must be verified on the installed firmware; this preview does not alter device settings to enable it.

Choose each `id` once. The ID determines the accessory UUID and survives a name or IP change. It is a local installation label, not proof of the physical serial number. The device name is checked on every snapshot, but this does not distinguish two E3 devices or independently certify the generation. Do not enable future controls until a physical identity mechanism is established.

Setting `enabled` to false or removing an entry removes its Marstek accessory on restart. Invalid configuration retains cached Marstek accessories as unavailable and starts no Marstek monitors. Each active ID and host/port/unit tuple must be unique. Existing settings migration preserves the new entries.

## Try it before the battery arrives

From the preview source directory, run:

```sh
npm run marstek:simulate
```

The simulator listens only on `127.0.0.1:15020`. It represents SOC 72.5%, charging 500 W and temperature 23.5 C. It never connects to real equipment. In another terminal:

```sh
npm run marstek:inspect -- 127.0.0.1 15020
```

For a test Homebridge running on the same computer, use the example `marstekDevices` entry with `host` set to `127.0.0.1` and `port` to `15020`. On a Pi, run the simulator on that Pi: `127.0.0.1` always means the machine running Homebridge. Stop it with Ctrl-C to observe stale state; restart it to observe recovery. Do not install this preview over the live bridge solely to run a simulation.

After physical installation, the read-only diagnostic command is:

```sh
npm run marstek:inspect -- BATTERY_IP 502
```

Optional `--include-controls` reads the community control/schedule addresses for evidence. Unsupported blocks are reported individually, with no writes and no automatic retry of a command. The simulator intentionally does not implement those control blocks.

## Register provenance and the attached paper

The implementation is new JavaScript, informed by published register facts. It does not include or run Home Assistant integration code. No new runtime dependencies were added.

Sources consulted on 4 November 2026:

- [ViperRNMC E3 register map](https://github.com/ViperRNMC/marstek_venus_modbus/blob/main/custom_components/marstek_modbus/registers/e_v3.yaml), from the MIT-licensed Marstek Venus Modbus project. Its own header says the map is partially validated and may contain incorrect or incomplete entries.
- [marstek-maestro hardware notes](https://github.com/ArthurTimmermans/marstek-maestro/blob/main/docs/modbus.md), reporting live Venus E 3.0 testing. These independently agree on the monitoring fields used here.
- [Firmware analysis](https://github.com/sphings79/Marstek-Venus-D-Firmware-Reverse-Engineering), background for future investigation, not authority for live writes.
- Owner-provided *Marstek Venus E 3.0 Dual-Battery Local Automation Architecture*, used as informative reference only.

| Field | MVP interpretation | Difference from attached paper |
|---|---|---|
| 30001 | Signed battery power, positive charging, negative discharging | Paper labels it AC power and reverses direction |
| 34002 | SOC raw / 10 | Paper states 1% scale |
| 32200 | AC voltage raw / 10 | Agrees |
| 35000 | Temperature signed raw / 10 | Additional monitoring field |
| 31000, 10 words | Reported device name | Read on each snapshot |
| 30200/30202/30204 | Raw EMS/VMS/BMS version words | Logged as raw version components, not decoded vendor release names |
| 42000/42010/42020/42021/43000 | Community control-map candidates, diagnostics only | Paper uses an uncorroborated 40001–40010 map |

The paper's example 400xx writes are not implemented. The packet reader uses literal documented addresses with no extra 40001 offset. It rejects invalid response identity, unit, protocol, length and byte count. Polls are serial per battery and do not overlap; failures back off from 5 seconds to 60 seconds. Reads are limited to 32 words. A fresh TCP session is created for each complete poll; it is closed at completion or failure. This avoids depending on a long-lived firmware session and does not assume a universal 30-minute refresh behaviour.

The paper's 16:00–18:15 / 18:15–19:00 export example is not implemented. Real coordination must account for reserves, SOC, losses, PV, house load, independently measured site export, actual power response and communications failures. Nominal battery capacity divided by rated inverter power does not establish an appropriate dispatch duration.

## Qualification after installation

1. Capture actual model, all firmware versions, wired connection details and raw snapshots. Compare SOC, temperature and voltage with the device app.
2. Observe idle, known charge and known discharge to establish power direction, scaling and threshold behaviour. Verify the reported name and physical-device binding.
3. Test repeated polls, disconnection, process restart and recovery. Check unsupported/quirky register blocks against this exact firmware. Current core polling requires all seven blocks; unsupported data faults the sample rather than silently selecting another profile.
4. Establish control register read/write semantics separately. Add a qualified capability profile, device-bound action journal, compare-before-write, uncertain-write reconciliation and interference tests before exposing controls.
5. Prove device-enforced targets and safe end-of-action behaviour, including a lost host. Then qualify IOG and tariff automation individually.
6. Prove coordinated GivEnergy/Venus behaviour against site measurements before claiming any combined export cap or multi-device Emergency Stop.

## Rollback

Before returning to a stable build, remove/disable Marstek entries while this preview is installed and restart once to remove its accessories. Restore the stable 4.1.2 package and saved configuration. The preview does not modify device settings or migrate existing GivEnergy storage formats.

## Validation

See `MARSTEK_VALIDATION.md` for recorded software checks and remaining gaps. Automated simulation is not hardware qualification.
