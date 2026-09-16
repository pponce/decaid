# Auto Steam Calculator source

This plugin is maintained and bundled inside Decaid. See
[the user and skin-developer guide](../../doc/CalibratedSteam.md).

Build from the repository root with `node packages/calibrated-steam/build.mjs`.
Run `npm test` in this directory for the JavaScript suite. No npm install is
needed. Source lives in `src/`, and the committed build output lives in
`../../assets/plugins/calibrated-steam.reaplugin/`.

The formula and automatic pitcher-selection heuristic are inspired by
[Damian / Damian-AU's DSx2](https://github.com/Damian-AU/DSx2). The new JavaScript
implementation is licensed under Decaid's GPL-3.0-only license.

`calibration-session.mjs` owns temporary machine settings and measured pouring
time. `calibration-page.js` owns the browser's scale capture and guided controls.
The runtime starts no calibration timers or machine writes until an explicit
calibration request. See the guide for lease, cancellation and restoration limits.

`flow-calibration.mjs` validates measured flow points and interpolates seconds per
gram between adjacent readings. `flow-calibration-page.js` owns the draft
single/multiple reading workflow; it reuses the host-owned guided session for
each reading. Single flow is the default; multiple readings use the existing
string setting type without adding a plugin-host schema requirement.
