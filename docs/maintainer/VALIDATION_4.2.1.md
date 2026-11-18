# GivHome 4.2.1 release validation

This patch addresses the All in One Cheap Overnight discharge observed on 18 November 2026. The previous night’s beta.8 recorder showed repeated re-arming at 99%. Stable 4.2.0 cleared the charge slot at 100% and its top-up guard failed to re-arm it.

Automated control tests cover keeping the native AIO slot armed at target, a child bridge restart, IOG and grace transitions, and restoring controls after the protected window. The release workflow validates the source and packed artifact before npm publication. The project owner authorised stable publication on 18 November 2026.

Live validation of the 05:30 handover and backup discharge during a mains outage remains pending. This release does not claim physical qualification for the patch or formal paired resource measurements.
