> Historical private-preview engineering record. For current optional setup and scope, see [Optional Venus information](VENUS_OPTIONAL.md).

# Combined-target coordinator preview — 5 November 2026

Private **4.1.3-marstek.4**, based on 4.1.2 and the .3 charging preview. All new site actions are **shadow proposals only**. No physical Marstek writer is provided and these new dimmers do not start physical AIO commands either. Existing GivEnergy automation retains its established control path. Not deployed to the live bridge.

## UI and use

Enable Combined battery target tiles (shadow preview) in the final Marstek section. This suppresses the eight timed Charge/Export tiles in the runtime configuration without rewriting their saved preferences. Disabling preview restores the established configuration on restart and removes only the owned preview accessories.

Three stable-identity accessories appear: Combined Battery Preview (read-only percentage), Charge to Preview and Export down to Preview. The latter two are native Lightbulb services with On and Brightness characteristics: brightness sets the percentage, On arms a proposal and Off cancels it. A percentage change cancels active intent; switch On to begin with the new target. Only one site intent can be active. The combined percentage is capacity-weighted across all online AIO slots plus the selected Venus. Configure usable capacity per AIO and Venus and their independent reserves. Default capacities are 13.5 and 5.12 kWh; confirm those conventions during commissioning.

Requires the existing selected-battery shadow reader, verified Venus AC direction, Gateway identity and fresh telemetry. Missing/offline members fault combined SOC instead of silently removing capacity from the denominator. Changes propagate on the next sample. Target and availability are separate: a combined export target below achievable reserves is not permission to break a reserve. The latest reason, powers, available energy and charging-time estimate are stored in Homebridge storage under `givhome-site-preview/latest-plan.json`. Read the timestamp: it is a last observation, not a heartbeat.

Targets and intent are stored atomically in `targets.json`. Restart restores preferences but holds interrupted actions; it never replays them. Corrupt state refuses startup. Manual intent has a six-hour maximum; reaching target, cancellation, external owner, Emergency Stop, hold or invalid telemetry disarms it. Site-wide Emergency Stop integration suppresses the new plans but does not physically stop Marstek. SOC remains available under a hold when telemetry is fresh.

## Allocation

Charging requires a configured installation-qualified import budget; zero proposes no charge. Existing measured battery contributions are removed before sharing available power between batteries. Site charging is capped against remaining import allowance with a 200 W margin. AIO-to-Venus charging is inhibited when measured AIO discharge exceeds 50 W. Overnight and IOG contexts retain separate targets and cancellation semantics. Existing AIO ownership takes precedence over this separate shadow planner; preview planning must not be confused with a replacement for the existing AIO automation.

Export uses measured Gateway net export, accounting for existing battery contributions and the remaining site contribution. AIO leads manual export allocation, with Venus assistance up to the unqualified-preview ceiling of 800 W. Independent reserves gate each battery. Peak assistance requires recognised GivHome export ownership, keeps the existing AIO contribution observational and proposes only a Venus supplement. Existing AIO charging blocks Venus discharge to avoid serving that charge. Export objective defaults to 6 kW with a 200 W operating margin.

The .3 Venus-only policy is still available as a comparison proposal stream; .4 adds a separate site planner. There is no pair of active writers. A future physical coordinator must replace comparison streams with one command authority. External manual actions, membership changes and generation/ownership must be qualified before actuation.

## Validation and limits

The suite includes weighted and missing-member SOC, stale/future/skewed readings, independent reserves, EV import allowance, existing-power compensation, peak assistance, PV contribution, target completion, holds, IOG/overnight separation, durable recovery, a two-hour charging model and native HAP dimmer interaction. Existing .3 delayed/lossy plant and read-only TCP tests remain included.

The new two-hour model is a software allocation test with 92% charging efficiency, not a hardware timing model. The six-second freshness threshold, operating margin, input/output caps and six-hour manual timeout remain preview choices. Export limiting is advisory: polling and commands cannot establish a hard instantaneous cap. Real charging/discharge limits, firmware, measured response, watchdog behaviour, emergency partial failure and safe restoration are still installation gates.

No Storm/Holiday modes, automatic physical dispatch, dynamic discharge uplift, individual target allocation UI, or physical Emergency Stop for Venus is claimed. Completion/restart protection for the older .3 overnight policy remains in-process; site manual recovery is durable. Installation import capacity is a separate setting from export permission. No new electrical installation limits are inferred by this build.
