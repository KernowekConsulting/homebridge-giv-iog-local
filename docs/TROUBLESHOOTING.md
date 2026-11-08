# Troubleshooting

Keep it simple. Start here before changing advanced settings.

## No data in Apple Home

Check:

- The inverter is on the same local network as Homebridge.
- The inverter IP address is correct.
- Port `8899` is reachable on the local network.
- The inverter serial is entered correctly.

## Values look stale

Restart the Homebridge child bridge and wait a minute.

If values still do not update, check the Homebridge log for connection or timeout messages.

## Export or charge controls do not start

For 4.1.3 and later, the retired CE/AC engineering flag and acknowledgement are ignored, including a false value saved by an older version. In **Apple Home controls**, check **Enable battery controls** and the individual feature you intend to use. Turning battery controls off blocks new actions and Emergency Stop; cleanup of already-owned actions remains available. An explicit false takes precedence over the legacy master alias.

Charge 30m starts a timed command. Charge Target saves a percentage preference; changing it alone does not start charging.

A queued or executing command is only an attempt. `responseBytesReceived=yes` means bytes arrived, not a validated protocol acknowledgement. `readback=verified` means the requested register value was read back. Physical charging still needs fresh battery/grid power telemetry; do not blindly repeat a command after an uncertain response.

The plugin is cautious. It may refuse a write if the inverter is already in a conflicting state, if readback fails, or if another export route appears active.

Check the log for phrases such as:

```text
readback
cleanup
refused
shared export route
Graceful Continuity
```

## Octopus features do not appear to run

Check the relevant switch in Apple Home and the matching settings in the Homebridge UI.

For Agile Export, planner-only/dry-run mode is deliberately safe: it plans but does not write to the inverter.

## Still stuck

Raise an issue with a short log excerpt. Remove private details first.
