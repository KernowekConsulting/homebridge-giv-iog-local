# GivHome 4.1.3 — Restore AC-coupled charging after upgrade

Fixed a configuration regression that could block Charge 30m and Intelligent Octopus Go battery protection on supported AC-coupled inverters. Older saved engineering settings no longer override enabled battery controls. The main control switch, individual feature choices, fresh inverter checks and verified restoration remain in force.

Charge 30m remains a timed command. Charge Target saves a percentage preference and does not start charging.

Write logs now distinguish response bytes from verified register readback. Physical battery flow still requires fresh telemetry.

Validated with isolated inverter simulations and native HomeKit tests; no new live inverter testing is claimed. Upgrading can resume already-enabled charging or IOG protection that the obsolete setting previously blocked. To keep controls off, disable the main battery control switch or the relevant feature before upgrading.

[Changes since 4.1.2](https://github.com/KernowekConsulting/homebridge-giv-iog-local/compare/v4.1.2...v4.1.3) · [Full Changelog](CHANGELOG.md)
