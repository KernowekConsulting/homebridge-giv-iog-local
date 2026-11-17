# Set up Marstek Venus E 3.0 in GivHome

Add a Venus E 3.0 to an existing GivHome installation with a compatible GivEnergy All in One and Gateway. GivHome uses the Gateway for household and grid readings, and talks directly to Venus on your home network.

## Before you start

- Have your GivEnergy setup working in GivHome. Find the Gateway’s IP address and serial number. The Gateway and All in One have separate addresses.
- Connect Venus to the same home network as Homebridge using Wi-Fi or Ethernet. Reserve its IP address in your router so it stays the same.
- In the Marstek app, turn on **Local API** and note the port. GivHome defaults to **30000**. The Gateway supplies the grid readings for this setup, so GivHome does not need a separate Marstek CT.
- For the battery check, leave Venus idle in **Manual** or **Passive** mode, with **25% to 99%** charge. Pause any active Venus schedules or other controllers before starting.

## Add Venus in Homebridge

1. Open **GivHome** settings and go to **Marstek Integration**. Select **I have a Marstek Venus battery**.
2. Enter the **Gateway IP address** and **Expected Gateway serial number**. Enter the **Venus Local API port** if you changed it in the app.
3. Select **Add Venus battery**. Choose an **Apple Home name** and enter the **Battery IP address**. Select the **Venus output limit** already configured on your battery, either **800 W** or **2.5 kW**, and set the **Charging limit (W)** you want GivHome to use.
4. To let GivHome operate both batteries, enable **Enable battery control** and review the **AIO reserve (%)** and **Venus reserve (%)**. For overnight charging on both, enable **Cheap Overnight for Venus** alongside your existing **Cheap Overnight** settings.
5. Save and restart Homebridge. Return to **Marstek Integration** and choose **Check connections**, then **Run battery check**. GivHome briefly charges and discharges Venus at 100 W, confirms it can stop, and checks that the battery’s own timer ends the action. Wait for **Ready**.

With control enabled, GivHome takes over Venus using Passive mode. Venus’s own Manual schedules are inactive while GivHome holds that mode.

## In Apple Home

- **AIO SOC** and the Venus battery level show the batteries individually. **Battery SOC** shows the combined charge, weighted by battery capacity.
- **Night Target** sets the Cheap Overnight target. The IOG charging target is set separately.
- **Charge To** and **Export To** use the combined percentage. The individual reserves still apply when discharging.
- **Pause Venus automation** in Homebridge pauses automatic Venus plans while keeping its readings available.

## If GivHome asks for another check

After a firmware update, go back to **Marstek Integration** and run the battery check again before resuming control. If GivHome identifies a different battery, verify the IP address. For a replacement, add it as a new battery and run setup for that unit.

If a test command is accepted but power stays at 0 W, check that Venus has mains power and can charge or discharge from its own app. If GivHome cannot confirm a stop, check the battery’s power and mode in the Marstek app before retrying.

Agile Export is available in planning mode on sites using Marstek Integration.
