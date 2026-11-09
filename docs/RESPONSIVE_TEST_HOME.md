# Responsive Test Home and user feedback

Private 4.1.3-marstek.11, based on 4.1.2 and .10. The live plugin is unchanged. The Mac Test Home uses only local Gateway and Venus TCP simulators, with existing pairing retained.

The simulated batteries default to 60%; the isolated test runner can choose a nearby starting SOC. Charge To increases their stored energy, Export To reduces it, and reaching a target turns the action Off through the existing coordinator. Off removes the request; simulated power then decays with a three-second response. Individual reserve gates and full bounds are modelled. The simulator now defaults to normal speed (1×); acceleration is explicit and optional. The CLI takes the feed path, speed and initial SOC, in that order. A separate plant-truth file and test-only HomeKit publication/subscriber diagnostics help distinguish physics, rounding and client display delays. Polling, freshness and leases use ordinary wall-clock time. This is a visible functional demonstration, not a charging-time prediction or a proven native watchdog.

The bridge's actual fresh proposal stream reaches the plant through an explicit preload hook used only by the Mac test runner. The hook is not loaded by the normal plugin or the live Pi. The plant rejects an old, expired or non-shadow feed. Its TCP listeners bind loopback; it accepts no physical device commands. The existing HomeKit bridge advertises on the Mac Wi-Fi interface so the phone can reach it.

## Plain-language feedback

The optional Venus panel shows a short status and one explanatory sentence: Ready, Charging plan active, Export plan active, Target reached, Paused, Battery unavailable, Waiting for Octopus, Keeping your reserve or Waiting for setup. The wording follows the established GivHome config descriptions: direct verbs, what is happening and what the user can do. Raw registers, owner generations and journals stay out of routine feedback. Since this remains a preview, active wording says **plan**, avoiding a false claim that physical equipment is charging.

Feedback has a separate five-second heartbeat and becomes unavailable after ten seconds without updates. The sixty-second engineering checkpoint is not treated as live status. These small public-status writes are separate from immediate safety journals. The panel makes no status requests for GivEnergy-only configurations. Detailed diagnostics remain optional. Apple Home retains its familiar percentage and On/Off controls; there is no extra collection of technical tiles.

The Home app test to perform after update: set Charge To to 70% and On, watch Combined SOC rise and the control return Off at completion. Set Export To to 60% and On, observe it fall and complete, then try cancelling an action with Off. Simulator reserve/full gates remain assumptions pending commissioning. An interrupted test action is held on restart; a previously saved target is retained but never auto-started.
