# v4.2.0-beta.7 validation

The CE compatibility candidate passed 1,001 source regression tests. The extracted candidate passed 135 CE and control-capability tests and 19 native HomeKit tests. Seven regression cases fail against v4.2.0-beta.6 and pass on the candidate. The CE fixture blocks external network access and covers 0x3001 firmware 212 and 214. Tests include charge enable restoration, immediate IOG pause, dispatch amendments and manual ownership preservation.

Register readback and simulation establish command behaviour. Physical CE charging and EV discharge protection remain to be checked. The beta channel is explicitly authorised by the project owner. The Marstek integration defaults to disabled and continues to require commissioning.
