> Historical iteration-1 results assumed a 2,500 W output ceiling. See [800 W correction](MARSTEK_INTEGRATION_UI.md) for current defaults.

# Iteration 1 simulation results

4 November 2026. Full default regression: **449 cases passed on Node 24.22.2** (424 preceding cases plus 25 new controller/adapter cases). Separate existing native HomeKit regression: **18 passed**. New controller suite: **25 passed on Node 22.23.4**. Existing release, forecast and documentation checks also passed. Node 22 full legacy suite was not rerun for this iteration.

The new suite includes 4,000 seeded changing-input steps across two modes. These are iterations, not distinct test cases or hardware trials.

| Synthetic scenario at second 89 | Marstek AC | AIO AC | Grid |
|---|---:|---:|---:|
| 1,200 W demand, residual | 1,163 W discharge | 0 W | 37 W import |
| 1,500 W surplus, residual | 1,462 W charge | 0 W | 38 W export |
| Eco AIO, residual | 0 W | 1,200 W discharge | 0 W |
| Eco AIO, house-support | 1,163 W discharge | 37 W discharge | 0 W |
| Lost telemetry, no AIO support | 0 W | 0 W | 1,200 W import |

A 50 W deadband permits small residual exchange. Import after stopping Marstek is expected. No physical devices were contacted. Gateway tests inject register responses using the established response shape. The prior real Gateway probe establishes transport separately. The plant assumes immediate lossless AC tracking and a responsive Eco AIO; physical device expiry and feedback-loop stability are unqualified. See GATEWAY_METER_CONTROLLER.md for limitations and next qualification steps.
