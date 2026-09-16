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

The settings page uses compact **General**, **Pitchers & Auto**, **Calibration**,
**Instructions**, and **Glossary** tabs. General contains scale weight mode, starting pitcher selection and steam
flow. The summary separates configured choices from calibration readiness and
updates as the draft changes. Configured S, M, L and Auto choices have green
badges; missing choices and calibration readiness remain separate text. Save is
required to persist changes. Both Flow
inputs edit the same `referenceFlow`. In Single flow, changing it clears the old
measured time. In Multiple flows, it is the default Auto flow; changing it within
the measured range preserves all readings.

Pitchers & Auto places empty-scale tare beside the pitcher rows. Each **Set from
scale** button fills its own field without focusing it first, and reports success
or failure in that row. The Auto switch is grouped with its two detection inputs.
Calibration has a second tare button, live scale status, a milk-capture result,
and a local explanation of what is needed to enable Prepare. Save reveals the
tab and manual-values section containing the first invalid setting.

1. Enter at least one empty pitcher weight, or use **Tare empty scale** and then
   **Set from scale** for each size. Wait for the stable-zero message before
   placing an empty pitcher on the scale. Blank or 0 means an unused size.
2. Optionally enable **Offer Auto pitcher selection**. This reveals the required
   usual milk per drink and the Small/Medium pitcher normally used for one drink.
   Damian's existing heuristic needs all three pitcher weights and gross scale
   weight. Auto is not offered until these inputs are valid; it is opt-in.
3. Choose a starting selection from the configured sizes (and Auto, if ready).
   With no configured pitchers, the selector says **Configure Pitchers & Auto
   first**. Configuring the first pitcher selects it automatically; adding other
   pitchers preserves that selection. You can change it in General before saving.
   Streamline remembers subsequent choices separately and falls back to the saved
   starting choice if the previously selected pitcher is removed.
4. Choose **Single flow** or **Multiple flows** in Calibration (details below),
   then follow **Guided calibration** for each reading:
   tare the empty scale, choose a configured pitcher, place it with cold milk on
   the scale, and **Capture pitcher + milk**. Review the milk-only weight,
   **Prepare calibration**, then **Start steam**. Stop at your preferred milk
   temperature using **Stop steam** or the machine control. Physical start also
   works after preparation. The page fills the measured weight, time and flow.
   Alternatively, choose **Enter measured time** for each reading and enter values
   measured using normal manual steam controls. Select **Use values and next**
   between readings, then review the completed set.
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
default. Single-flow calibration fixes Auto at that measured flow. Multiple-flow
calibration permits adjustment only between its lowest and highest measured flows.

Auto applies the calibration flow. After calculation, Streamline restores its
normal heater setting from before Auto was entered (or its existing remembered
normal setting if steam was already Off). No heater setting is stored in the
calculator, and no temperature compensation is performed. Entering Auto, finishing a steam cycle, reloading an active session, or leaving
an armed calculation on the main page resets to **Off** until the next calculation.
Navigation never waits for this background reset. A confirmed Off state is retained
across ordinary navigation; unchanged settings are not rewritten. Focus and merely
opening/closing settings do not refresh steam settings. Reconnect and actual plugin
configuration changes revalidate them. Duplicate resets share one pending operation;
a calculation in progress is invalidated if the user leaves the main page. Off means duration 0 and heater target 0, matching Streamline's manual
Off behavior. It is a reminder rather than a hardware start interlock: a physical
start may still produce a brief steam burst. Resets wait until the machine is idle.

The skin saves the previous manual duration, flow, heater target and probe-stop
setting before entering Auto and restores them on exit or plugin disable. A disable
during steaming defers restoration until idle. Auto values do not replace manual
preferences or profile values. While Auto is active, use pitcher presets to set the
time. Manual number editors stay inactive in Auto. Single-flow Auto hides only the − / + icons, keeping their gray button backgrounds visible and disabled.
Multiple-flow Auto shows them for flow adjustment in 0.1 ml/s steps within the
calibrated range, while the machine is idle. Changing flow resets time to Off; tap
the pitcher again to calculate from the current scale weight. The selected Auto
flow is remembered separately from manual flow and resets to the default when
calibration settings change. Normal Flow and Time modes keep − / +.

**Gross** means pitcher plus milk: start with the empty scale at zero and do not tare
the pitcher. **Tared** means milk only: no pitcher weight is subtracted and automatic pitcher
identification is unavailable. The software cannot detect a physical tare button
press; the selected mode must match the scale display.

## Single and multiple flow calibration

Single flow retains the original measured milk weight, time and fixed flow.
Single flow is the default calibration mode.

Multiple flows asks for a minimum and maximum between 0.4 and 2.5 ml/s and **2, 3
(recommended), or 4 readings**. Two uses both endpoints; three adds a midpoint;
four adds two evenly spaced interior points, rounded to 0.1 ml/s. A range must
allow distinct points at least 0.1 ml/s apart. For 0.4–2.5 ml/s, the four points
are 0.4, 1.1, 1.8 and 2.5 ml/s. The default Auto flow must lie within that range.

Set **Target milk per reading (g)** to the amount you intend to prepare. This is
saved independently from the actual measured milk weight: a 160 g target stays
160 g when a reading uses 158 g. Calculations use the actual measurement.

**Target calibration temperature (°C)** is an optional milk-temperature note,
initially blank. It does not set the steam heater, stop steam, or change calculated
time. Aim for the same target for every reading. If you later calibrate to a
different temperature, update this note and repeat the readings for that target.
The note appears alongside the flow, actual milk weight and time in each compact
summary. Editing the note alone does not adjust existing measurements.

For each point, use the same pitcher,
milk starting temperature, target temperature, heater setting and technique. Use
fresh milk for each run, not milk already heated by the previous reading. Record
the actual milk weight if it differs slightly from the target.

Each point offers manual time entry or the existing guided calibration. The
reading heading shows its required flow. Guided Prepare applies that flow, not
the default Auto flow. Start remains unavailable until preparation completes and
rechecks the workflow's flow, duration and probe-stop settings before requesting
steam. No successful result is returned until prior steam settings are restored.

Select **Use values and next** after each measurement, then **Use values and
review** to see the compact summaries. Saved calibrations reopen in this compact
view. Each **Edit** button opens its reading for manual adjustment or a new guided
run. Accepting an edit returns to review when all readings are complete and retains
the other measurements. Changing the planned range/count clears the
draft readings; editing a captured reading requires using it again. Save stores
the complete set through one settings request. Until Save, the previous saved
calibration remains active; leaving without saving discards the draft. The page
does not save invented readings or sample times.

## Guided calibration details

Tare always means an **empty scale**, never a pitcher already on it. The page waits
for a stable zero (within 0.5 g), then allows capture from at least three fresh
samples spanning 500 ms with no more than 2 g spread. This cannot detect a later
press of the scale's physical tare button. Repeat the empty-scale tare if unsure.
Guided calibration always subtracts the explicitly selected pitcher from gross
weight, including when everyday calculation uses Tared mode. Auto inference is
not used for calibration. Initial milk weight is frozen before steam starts;
removing the pitcher from the scale does not change it.

Preparation applies the current reading's flow (0.4–2.5 ml/s), the existing normal heater
setting and a temporary duration of 255 seconds, with probe stopping disabled.
255 is the existing machine timer ceiling, not a new user setting. The user stops
at their desired temperature. The measured counter follows machine snapshot
`pouring` time, excluding warm-up, and waits for confirmed idle before completing.
Runs reaching the timer ceiling, paused runs and interrupted telemetry are not
accepted as calibration. After review, Save stores values and returns to settings.
Changing a single calibration flow clears its measured time and requires a new
measurement. Changing a multiple calibration default inside the measured range
does not discard readings. Capture fresh milk to repeat any guided reading.

The plugin owns preparation and restoration; the page renews its session lease.
Return to settings cancels an active run and waits for restoration before navigating.
Page closure or a six-second heartbeat gap cancels the run. Machine telemetry gaps
over three seconds invalidate it. The plugin requests stop and restores the prior
steam settings after confirmed idle, retrying a failed restoration while loaded.
Results are exposed only after restoration succeeds. App termination or forcibly
unloading the plugin ends this protection; incomplete results are never saved and
previous settings should be checked after restarting. A stopped app cannot issue
machine commands. The machine's own timer remains in effect.

For a low milk weight, the main controls show a compact message such as
**Milk < 10 g · Medium pitcher**. Auto names the pitcher chosen by the heuristic;
tared mode identifies milk-only weight. The validation range remains unchanged.

## Attribution and calculation

The formula and pitcher-selection heuristic are inspired by Damian / Damian-AU's
[DSx2](https://github.com/Damian-AU/DSx2), specifically `skin_steam_time_calc` in
`code/procs_vars.tcl`. This is a new JavaScript implementation; it does not copy
DSx2's Tcl UI or artwork. Damian is credited in the manifest and settings UI.

Single flow: `seconds = round(referenceSeconds × milkGrams / referenceMilkGrams)`.

Multiple flows normalize each reading to `rate = seconds / milkGrams`. For a
requested flow between adjacent measured flows `f0` and `f1`, let
`p = (flow - f0) / (f1 - f0)`. Then
`seconds = round(milkGrams × ((1-p) × rate0 + p × rate1))`.
Measured endpoints retain their measured rate. There is no curve fitting or
extrapolation beyond the measured range. This extension to the original ratio
is an empirical estimate; it still assumes time scales approximately with milk
mass. Heater-temperature compensation and pitcher inference are unchanged.

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
| GET | `status` | API version, `calibrationActive`, readiness, `availablePitchers`, current settings, validation errors and setting schema |
| GET | `ui` | Standalone settings form with a `returnTo` query parameter |
| POST | `validate` | Validate a complete settings object without storing it |
| POST | `calculate` | Return a calculation and duration/flow workflow patch; performs no write |
| POST | `calibration` | Prepare, start, stop, cancel or renew an owned guided calibration session |

Prefix endpoints with `/api/v1/plugins/calibrated-steam.reaplugin/`.
Settings are persisted through the existing
`POST /api/v1/plugins/calibrated-steam.reaplugin/settings` endpoint. That endpoint
reloads a loaded plugin. Use `validate` first for actionable calibration errors.
The form and its endpoints work offline against the local Decaid server.

Status includes `availablePitchers`, for example `["medium"]` or
`["small", "medium", "large", "auto"]`. Render these choices instead of hard-coding
four buttons. Gate calculation on `ready`, re-read status when settings change,
and reject a saved selection no longer present. `autoDetect` defaults to false;
missing pitcher weights are 0. Automatic detection requires all three weights,
`singleDrinkGrams`, `singleDrinkPitcher` and gross mode. Saving manual-only settings
requires at least one pitcher and the calibration, without Auto-specific inputs.
Settings and API fields consistently use pitcher terminology: `smallPitcherGrams`,
`mediumPitcherGrams`, `largePitcherGrams`, `singleDrinkPitcher`, `defaultPitcher`,
`pitcher`, `pitcherGrams` and `pitcherSource`.

Open the form as a normal page rather than an iframe. Supply the calling skin's
settings address using `?returnTo=` plus a URL-encoded absolute URL. The form
uses that address for its top return link and successful save. It accepts HTTP(S)
addresses on the same host (including equivalent loopback names), with no embedded
credentials; the skin port and route are preserved. Without a valid address it
tries a same-host referrer, then falls back to Decaid's settings plugin. The plugin
has no dependency on Streamline routes. Streamline supplies its `?page=settings`
URL and restores the selected settings category from its existing navigation state.


### Multiple-flow capability

Status includes `flowCalibration`, either null for invalid
calibration data or `{mode, adjustable, minimum, maximum, defaultFlow, readings}`.
Each reading is `{flow, milkGrams, seconds}`. Also require `ready`; valid flow
readings alone do not establish valid pitcher settings.

Persist `calibrationMode` (`single` by default, or `multiple`) and `flowReadings`
(a JSON string containing the ordered 2–4 reading objects). A string is used
because the existing plugin setting schema supports primitive types. Custom
skins should use the shared settings page instead of exposing raw JSON. The
`referenceMilkGrams` and `referenceSeconds` fields define the single calibration;
in multiple mode the readings are authoritative. `referenceFlow` is the shared
fixed/default flow, with a default of 0.4. Changing that default does not mutate
multiple readings.

`targetMilkGrams` is the planned milk quantity (default 200 g), separate from
`referenceMilkGrams` and each reading's actual `milkGrams`. `targetTemperatureC`
is an optional shared milk-temperature note (0 means unspecified). Neither field
is used by the duration calculation or sent as a machine setting. Skins should
preserve these settings when editing configuration; using the shared settings
page handles this automatically.

A `calculate` body may include optional numeric `flow`. If omitted, the plugin
uses `referenceFlow`. Single mode
requires its fixed flow. Multiple mode rejects values outside measured bounds
with `flow_out_of_range`; invalid calibration returns `configuration_required`.
Pass the selected flow on every preview and revalidation, compare the returned
flow as well as duration/revision, and apply that exact duration/flow pair. A flow
change invalidates an armed calculation. Never retain its previous duration or
reuse a prior milk measurement silently. Keep manual steam preferences separate.

### Reusing guided calibration in another skin

Opening the shared `ui` is sufficient; skins do not need their own scale or
calibration UI. When temporarily parking the heater Off, a skin may pass its
remembered normal heater target as `steamHeaterTemperature=145` alongside
`returnTo`. Only integer targets 135–165 °C are accepted. The live workflow's
positive heater target takes precedence. If neither is available, the page asks
the user to enable the normal steam heater before calibrating. The value is used
for machine operation, not stored as calibration or used for temperature scaling.
Streamline supplies its existing saved target from both Open settings entry points.

Before an Auto workflow write, consult `status.calibrationActive`. If true, defer
Auto resets, calculated writes and manual-backup restoration. Do not rewrite
steam settings from another client during calibration. `calculate` returns 409
while calibration owns the machine settings. This is cooperative skin coordination,
not a global lock on Decaid's workflow API.

A custom guided UI can `POST calibration` with:

```json
{"action":"begin","pitcher":"small","pitcherGrams":150,"milkGrams":160,"flow":0.4,"heaterTemperature":145}
```

`begin` validates idle state, fresh host machine telemetry, pitcher/milk ranges,
flow and heater availability before preparation. Weights come from the caller's
validated capture; the endpoint does not authenticate scale samples. The response
includes an opaque `token`, `active`, `phase`, `message`, `seconds`, `measurement`
and `result`. Subsequent requests use `{action, token}`, with action `heartbeat`,
`start`, `stop` or `cancel`. Renew at least every two seconds while active; the
bundled page renews every 500 ms to show the counter. Only the owning token can
control a session; concurrent begins return 409. Phase progresses through
`preparing`, `armed`, `starting`/`heating`/`steaming`, `restoring`, then `complete`
or `failed`. Result remains null until a valid run has ended and restoration
has succeeded. A complete result contains milkGrams, pitcher, pitcherGrams, flow
and measured seconds. It is not automatically persisted. On page hide, request
cancel with keepalive; the lease is the fallback if that request cannot arrive.
Do not reload or disable the plugin during an active session.

Example request body for `calculate`:

```json
{
  "samples": [
    {"weightGrams": 330, "ageMs": 800},
    {"weightGrams": 330, "ageMs": 400},
    {"weightGrams": 330, "ageMs": 0}
  ],
  "pitcher": "auto",
  "machineState": "idle",
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
`pitcher: "small"`, `pitcherSource: "heuristic"`, `milkGrams: 180`,
`durationSeconds: 30`, and:

```json
{"steamSettings": {"duration": 30, "flow": 1.5}}
```

The response also contains `scaleGrams`, `pitcherGrams`, `apiVersion: 4` and an opaque
`calibrationRevision`. Do not parse the revision: compare it to invalidate a
preview when the settings change. `pitcherSource` is `heuristic`, `manual` or `tared`.
Tared mode requires an explicit configured pitcher choice; Auto detection is unavailable.

Check `status.apiVersion` before using the calculator; the current contract is 4.
The plugin manifest's `apiVersion` identifies the Decaid host API and remains 1.
The workflow patch contains duration and flow only; the skin owns heater handling.
There is no configurable maximum duration; results must fit the supported
1–255-second timer range.

Damian's `skin_steam_time_calc` uses calibration time, calibration milk weight,
scale weight and pitcher weight. It neither scales time for heater temperature nor
captures a heater calibration value, and has no separate maximum-duration cap.
The matching equation here likewise does not compensate for heater or starting
milk temperature. Recalibrate if the steaming conditions change.

Before applying, obtain fresh workflow and machine state and recalculate with
fresh scale samples. Reject changed observations or calibration. Apply duration
and flow together through `PUT /api/v1/workflow`; never start steam or run the
stop countdown in a WebView. If the skin has put steam Off, restore its existing
normal heater setting as part of the same write. Do not invent a new heater target
or use one to change the calculated time. Probe stopping must be zero when
calculating. Streamline captures its prior value and clears it on Auto entry.

Skins own Auto-session transitions. Capture and persist the manual settings before
writing Off, keep them through reloads and failed writes, and restore them before
releasing Auto ownership. Suppress normal manual-setting reconciliation while
Auto owns the steam settings, including reconciliation already waiting on a read.
Never queue a failed calculation for later replay or claim success before the
workflow write succeeds. A lost response can leave the final state uncertain.
Separate calculation and application calls are not an atomic machine lock.

HTTP 422 carries `{code, message}` for configuration, scale readiness, invalid
milk mass, the supported timer range, non-idle machine or active probe stop. An unloaded plugin is rejected by Decaid with 404 before dispatch.
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
  -d '{"autoDetect":true,"smallPitcherGrams":150,"mediumPitcherGrams":220,"largePitcherGrams":300,"singleDrinkGrams":160,"singleDrinkPitcher":"small","weightMode":"gross","referenceMilkGrams":150,"referenceSeconds":25,"referenceFlow":1.5}'
curl -sf -X POST http://localhost:8080/api/v1/plugins/calibrated-steam.reaplugin/calculate \
  -H 'Content-Type: application/json' \
  -d '{"samples":[{"weightGrams":330,"ageMs":800},{"weightGrams":330,"ageMs":400},{"weightGrams":330,"ageMs":0}],"machineState":"idle","stopAtTemperature":0}'
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
