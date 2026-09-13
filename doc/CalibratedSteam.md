# Auto Steam Calculator

This bundled, opt-in plugin estimates steam duration from a known milk-weight/time
calibration. It does not measure milk temperature. Decaid owns the plugin and its
settings; a supporting skin owns the controls and uses the ordinary workflow API
to apply the duration. DYE2 is neither required nor modified.

## Setup and use

In Streamline, open **Settings > Extensions > Auto Steam Calculator**. Enable the
extension, then choose **Open settings**. The standalone page is also available
from **Extensions > Plugins > Open**. Both entry points provide a return address:
**Return to settings** leaves without saving, and a successful **Save calibration**
returns to the calling settings page. Validation or save errors keep the form open.

1. Enter at least one empty pitcher weight. Blank or 0 means an unused size.
2. Optionally enable **Offer Auto pitcher selection**. This reveals the required
   usual milk per drink and the Small/Medium pitcher normally used for one drink.
   Damian's existing heuristic needs all three pitcher weights and gross scale
   weight. Auto is not offered until these inputs are valid; it is opt-in.
3. Choose a starting selection from the configured sizes (and Auto, if ready).
   Streamline remembers subsequent choices separately and falls back to the saved
   starting choice if the previously selected pitcher is removed.
4. Using manual Flow or Time mode, steam a known milk-only weight to your preferred
   temperature. Record the time, flow and heater target and enter this calibration.
5. Save. Use similar milk, starting temperature and technique on later runs.

Only configured sizes appear in the steam presets. With no setup, top-level Auto
remains available while the extension is enabled, but it stays Off and shows a
setup reminder. Calibration must be valid before a preset can calculate. Manual
Flow and Time remain available regardless of extension setup.

Streamline shows **Auto | F | T**, with the active mode blue. Tap the Steam heading
or mode label to cycle. In Auto, the usual preset row shows the configured **S / M / L** choices, plus **Auto** only when automatic detection is configured.
Place the filled pitcher on the scale and tap a preset to calculate and apply. Tapping
an already-selected preset recalculates; no preview dialog or Use time button is
involved. Success shows pitcher, milk mass and seconds; start steam normally afterward.

Auto flow is configurable from **0.4 to 2.5 ml/s**, with **0.4 ml/s** as the
default. Measure the calibration time at this flow; recalibrate if it changes.

Auto applies the calibration flow and, when calculating, the calibration heater
target. Entering Auto, finishing a steam cycle, reloading an active session, or
returning to it after settings/focus refresh resets to **Off** until the next
calculation. Off means duration 0 and heater target 0, matching Streamline's manual
Off behavior. It is a reminder rather than a hardware start interlock: a physical
start may still produce a brief steam burst. Resets wait until the machine is idle.

The skin saves the previous manual duration, flow, heater target and probe-stop
setting before entering Auto and restores them on exit or plugin disable. A disable
during steaming defers restoration until idle. Auto values do not replace manual
preferences or profile values. While Auto is active, use pitcher presets to set the
time; manual number editors and plus/minus are inactive.

**Gross** means pitcher plus milk: start with the empty scale at zero and do not tare
the pitcher. **Tared** means milk only: no pitcher weight is subtracted and automatic pitcher
identification is unavailable. The software cannot detect a physical tare button
press; the selected mode must match the scale display.

## Attribution and calculation

The formula and pitcher-selection heuristic are inspired by Damian / Damian-AU's
[DSx2](https://github.com/Damian-AU/DSx2), specifically `skin_steam_time_calc` in
`code/procs_vars.tcl`. This is a new JavaScript implementation; it does not copy
DSx2's Tcl UI or artwork. Damian is credited in the manifest and settings UI.

`seconds = round(referenceSeconds × milkGrams / referenceMilkGrams)`

For gross weight `W`, empty small/medium pitcher weights `S`/`M`, and usual
single-drink milk mass `D`:

| Normal single-drink pitcher | Select medium when | Select large when |
| --- | --- | --- |
| Small | `W > 1.7 × D + S` | `W > 2.7 × D + M` |
| Medium | `W > 0.7 × D + S` | `W > 1.7 × D + M` |

Selection starts at small, then evaluates medium and large in order; large wins
when both conditions hold. Comparisons are strictly greater-than, matching DSx2.
The selected empty-pitcher weight is subtracted from gross weight. A manual choice
overrides the heuristic. Total weight cannot uniquely identify every possible
pitcher/milk combination: skins must display the inference and allow correction.

## Skin developer contract

Discover the plugin through `GET /api/v1/plugins`. Its id is
`calibrated-steam.reaplugin`. Activate controls only when it is **loaded** and
declares the `calculate` HTTP endpoint. `autoLoad` is a startup preference, not
proof that the plugin is running. Restore the skin's usual steam UI if disabled.

| Method | Plugin endpoint | Purpose |
| --- | --- | --- |
| GET | `status` | API version, readiness, `availablePitchers`, current settings, validation errors and setting schema |
| GET | `ui` | Standalone settings form with a `returnTo` query parameter |
| POST | `validate` | Validate a complete settings object without storing it |
| POST | `calculate` | Return a calculation and duration, flow and heater workflow patch; performs no write |

Prefix endpoints with `/api/v1/plugins/calibrated-steam.reaplugin/`.
Settings are persisted through the existing
`POST /api/v1/plugins/calibrated-steam.reaplugin/settings` endpoint. That endpoint
reloads a loaded plugin. Use `validate` first for actionable calibration errors.
The form and all four endpoints work offline against the local Decaid server.

Plugin v0.3.0 adds `availablePitchers` to status, for example `["medium"]` or
`["small", "medium", "large", "auto"]`. Render these choices instead of hard-coding
four buttons. Gate calculation on `ready`, re-read status when settings change,
and reject a saved selection no longer present. `autoDetect` defaults to false;
missing pitcher weights are 0. Automatic detection requires all three weights,
`singleDrinkGrams`, `singleDrinkJug` and gross mode. Saving manual-only settings
requires at least one pitcher and the calibration, without Auto-specific inputs.
Compatibility keys such as `smallJugGrams`, `defaultJug`, `jug` and `jugSource`
remain unchanged to preserve existing saved settings and API clients; all UI
labels use “pitcher.” Older settings retain their calibration, but automatic
detection must be explicitly enabled after upgrading.

Open the form as a normal page rather than an iframe. Supply the calling skin's
settings address using `?returnTo=` plus a URL-encoded absolute URL. The form
uses that address for its top return link and successful save. It accepts HTTP(S)
addresses on the same host (including equivalent loopback names), with no embedded
credentials; the skin port and route are preserved. Without a valid address it
tries a same-host referrer, then falls back to Decaid's settings plugin. The plugin
has no dependency on Streamline routes. Streamline supplies its `?page=settings`
URL and restores the selected settings category from its existing navigation state.


Example request body for `calculate`:

```json
{
  "samples": [
    {"weightGrams": 330, "ageMs": 800},
    {"weightGrams": 330, "ageMs": 400},
    {"weightGrams": 330, "ageMs": 0}
  ],
  "jug": "auto",
  "machineState": "idle",
  "steamFlow": 1.5,
  "steamTemperature": 150,
  "stopAtTemperature": 0
}
```

Supply real observations from the skin's existing scale stream. Do not duplicate
one reading to manufacture a stable window. Samples must be oldest-to-newest,
have strictly decreasing nonnegative ages, span at least 500 ms, contain 3–64
readings, have a spread no greater than 2 g and be no older than 2500 ms; the
newest must be at most 1500 ms old. The median determines the mass. Clear samples
on disconnect, reconnection, scale replacement and backward clock changes.
Timestamp ages are caller-provided; this API cannot authenticate the observations
or guarantee that a skin is reporting actual live hardware state.

With a 150 g small pitcher and a 150 g / 25 s calibration, the example returns
`jug: "small"`, `jugSource: "heuristic"`, `milkGrams: 180`,
`durationSeconds: 30`, and:

```json
{"steamSettings": {"duration": 30, "flow": 1.5, "targetTemperature": 150}}
```

The response also contains `scaleGrams`, `jugGrams`, `apiVersion: 2` and an opaque
`calibrationRevision`. Do not parse the revision: compare it to invalidate a
preview when the settings change. `jugSource` is `heuristic`, `manual` or `tared`.
Tared mode requires an explicit configured pitcher choice; Auto detection is unavailable.

The calculator contract is version 2 (plugin manifest apiVersion remains the
Decaid host contract version 1). Earlier draft clients expecting a duration-only
patch must update. Check status.apiVersion before activating a client.

Before applying, obtain fresh workflow and machine state and recalculate with
fresh scale samples. Reject changed observations or calibration. Apply the returned
three fields together through `PUT /api/v1/workflow`; never start steam or run the
stop countdown in a WebView. The supplied heater target may be 0 (Off); a different
enabled target must match calibration. Current flow may differ because the
returned flow is applied. Probe stopping must be zero when calculating. Streamline
captures its prior value and explicitly clears it on Auto entry.

Skins own Auto-session transitions. Capture and persist the manual settings before
writing Off, keep them through reloads and failed writes, and restore them before
releasing Auto ownership. Suppress normal manual-setting reconciliation while
Auto owns the steam settings, including reconciliation already waiting on a read.
Never queue a failed calculation for later replay or claim success before the
workflow write succeeds. A lost response can leave the final state uncertain.
Separate calculation and application calls are not an atomic machine lock.

HTTP 422 carries `{code, message}` for configuration, scale readiness, invalid
milk mass, duration limits, non-idle machine, active probe stop or heater
mismatch. An unloaded plugin is rejected by Decaid with 404 before dispatch.
Handle unavailable plugins and API failures without applying a cached result. Requests for an unavailable pitcher return `pitcher_not_configured`.

## Source and maintenance

- Editable source: `packages/calibrated-steam/`.
- Bundled output: `assets/plugins/calibrated-steam.reaplugin/`.
- Build: `node packages/calibrated-steam/build.mjs` (no third-party dependencies).
- JavaScript tests: `node --test packages/calibrated-steam/test/*.test.mjs`.
- Native host tests: `flutter test test/plugins/calibrated_steam_plugin_test.dart`.

Commit the generated `manifest.json` and `plugin.js` whenever source changes. CI
checks that they match. Bump `manifest.src.json` and the package version when
shipping a changed plugin so Decaid upgrades older installed copies. No external
repository or external release-download job is involved.

The companion Streamline integration lives in `streamline-js`; Decaid does not
own or rewrite installed skins. Other skins use the same API without copying the
calculation or maintaining their own calibration settings.

## Runtime verification before release

Run the app with `scripts/sb-dev.sh start --connect-machine MockDe1` and confirm
`scripts/sb-dev.sh status` reports a connected mock machine. With the local API:

```sh
curl -sf -X POST http://localhost:8080/api/v1/plugins/calibrated-steam.reaplugin/enable
curl -sf http://localhost:8080/api/v1/plugins/calibrated-steam.reaplugin/status
curl -sf -X POST http://localhost:8080/api/v1/plugins/calibrated-steam.reaplugin/settings \
  -H 'Content-Type: application/json' \
  -d '{"autoDetect":true,"smallJugGrams":150,"mediumJugGrams":220,"largeJugGrams":300,"singleDrinkGrams":160,"singleDrinkJug":"small","weightMode":"gross","referenceMilkGrams":150,"referenceSeconds":25,"referenceFlow":1.5,"referenceSteamTemperature":150,"maxSeconds":120}'
curl -sf -X POST http://localhost:8080/api/v1/plugins/calibrated-steam.reaplugin/calculate \
  -H 'Content-Type: application/json' \
  -d '{"samples":[{"weightGrams":330,"ageMs":800},{"weightGrams":330,"ageMs":400},{"weightGrams":330,"ageMs":0}],"machineState":"idle","steamFlow":1.5,"steamTemperature":150,"stopAtTemperature":0}'
```

The initial status must be unconfigured on a clean installation; after setting
the fixture calibration, calculation must return 180 g of milk and 30 seconds.
Compare `GET /api/v1/workflow` before and after: calculation must not change it.
An empty sample array or busy state must return 422. These supplied samples test
the HTTP contract only; they do not replace live-scale verification.

Reload with `scripts/sb-dev.sh reload`, confirm settings remain, and repeat.
Disable the plugin through its `/disable` endpoint and confirm `/calculate`
returns 404; restart and confirm it stays disabled. Inspect
`scripts/sb-dev.sh logs -n 30 --filter error`, then `scripts/sb-dev.sh stop`.

On the tablet, verify the 114 px mode label and four preset touch targets in
light/dark mode; heading and label cycling; direct Settings > Extensions access
before and after visiting a legacy settings page; enable/disable; gross/tared
weighing; repeated taps on the same pitcher; and persistence across reloads. Verify
entry and post-steam Off, automatic calibration-flow application, manual-setting
restoration and a deferred disable while steaming. A failed scale/calibration
check must leave Auto Off, and a failed write must not be reported as success.
Validate actual stopping temperature with a thermometer; simulated tests cannot
establish thermal accuracy or the length of a physical-start burst in Off.
