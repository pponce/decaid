# Calibrated Steam Timer

This bundled, opt-in plugin estimates steam duration from a known milk-weight/time
calibration. It does not measure milk temperature. Decaid owns the plugin and its
settings; a supporting skin owns the controls and uses the ordinary workflow API
to apply the duration. DYE2 is neither required nor modified.

## Setup and use

1. Enable **Calibrated Steam Timer** in Decaid's plugin settings.
2. Open its settings UI. Supporting skins can link to
   `/api/v1/plugins/calibrated-steam.reaplugin/ui` on Decaid's API server.
3. Weigh and record each empty jug: small, medium and large.
4. Record your normal milk weight for one drink and whether that drink normally
   uses the small or medium jug. These values select the detection thresholds.
5. Perform a calibration run: record milk-only weight, actual steaming time until
   your preferred milk temperature, steam flow and steam heater temperature.
   Use similar initial milk temperature, milk type and technique subsequently.
6. Set a maximum calculated duration. Results exceeding it are rejected, not
   silently shortened. The supported upper limit is 255 seconds.
7. In a supporting skin, place the filled jug on the connected scale, choose
   **Auto Calc**, check the estimated jug and milk weight, then choose **Use time**.
   Keep the jug on the scale until the setting has been applied. Starting steam is
   still a separate action. The machine's duration setting performs the stop.

**Gross** means jug plus milk: start with the empty scale at zero and do not tare
the jug. **Tared** means milk only: no jug weight is subtracted and automatic jug
identification is unavailable. The software cannot detect a physical tare button
press, so the selected mode must match what the scale displays.

Steam flow and heater target must match the calibration. The plugin will not
silently change them, compensate for a different flow, enable a disabled heater,
or disable a milk-probe stop. Disable probe-based stopping explicitly before
using the calibrated timer. A heater parked by Eco Steam must be restored to the
calibration target first.

## Attribution and calculation

The formula and jug-selection heuristic are inspired by Damian / Damian-AU's
[DSx2](https://github.com/Damian-AU/DSx2), specifically `skin_steam_time_calc` in
`code/procs_vars.tcl`. This is a new JavaScript implementation; it does not copy
DSx2's Tcl UI or artwork. Damian is credited in the manifest and settings UI.

`seconds = round(referenceSeconds × milkGrams / referenceMilkGrams)`

For gross weight `W`, empty small/medium jug weights `S`/`M`, and usual
single-drink milk mass `D`:

| Normal single-drink jug | Select medium when | Select large when |
| --- | --- | --- |
| Small | `W > 1.7 × D + S` | `W > 2.7 × D + M` |
| Medium | `W > 0.7 × D + S` | `W > 1.7 × D + M` |

Selection starts at small, then evaluates medium and large in order; large wins
when both conditions hold. Comparisons are strictly greater-than, matching DSx2.
The selected empty-jug weight is subtracted from gross weight. A manual choice
overrides the heuristic. Total weight cannot uniquely identify every possible
jug/milk combination: skins must display the inference and allow correction.

## Skin developer contract

Discover the plugin through `GET /api/v1/plugins`. Its id is
`calibrated-steam.reaplugin`. Activate controls only when it is **loaded** and
declares the `calculate` HTTP endpoint. `autoLoad` is a startup preference, not
proof that the plugin is running. Restore the skin's usual steam UI if disabled.

| Method | Plugin endpoint | Purpose |
| --- | --- | --- |
| GET | `status` | API version, readiness, current settings, validation errors and setting schema |
| GET | `ui` | Standalone calibration settings form; can be embedded in an iframe |
| POST | `validate` | Validate a complete settings object without storing it |
| POST | `calculate` | Return a calculation and duration-only workflow patch; performs no write |

Prefix endpoints with `/api/v1/plugins/calibrated-steam.reaplugin/`.
Settings are persisted through the existing
`POST /api/v1/plugins/calibrated-steam.reaplugin/settings` endpoint. That endpoint
reloads a loaded plugin. Use `validate` first for actionable calibration errors.
The form and all four endpoints work offline against the local Decaid server.

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

With a 150 g small jug and a 150 g / 25 s calibration, the example returns
`jug: "small"`, `jugSource: "heuristic"`, `milkGrams: 180`,
`durationSeconds: 30`, and:

```json
{"steamSettings": {"duration": 30}}
```

The response also contains `scaleGrams`, `jugGrams`, `apiVersion: 1` and an opaque
`calibrationRevision`. Do not parse the revision: compare it to invalidate a
preview when the settings change. `jugSource` is `heuristic`, `manual` or `tared`.
In tared auto mode `jug` is null; skins must not present a guessed container.

Before applying, obtain a fresh workflow and machine state, recalculate with fresh
scale samples and reject a changed calibration, jug, weight, workflow or result.
Do not write while the machine is busy or disconnected. Apply only the duration
through `PUT /api/v1/workflow`, using the skin's normal persistence and error
handling. Do not restore an unrelated remembered heater target. Never start steam
or run the stop countdown in a WebView. Do not show success until the workflow
write succeeds; transport failures can still leave the final state uncertain.
Calculation and application are separate operations, not an atomic machine lock.

Streamline expires previews after 15 seconds, rejects slow calculation responses
when observations expire, and remembers a duration only after a successful
workflow write. Other skins should also avoid queuing a failed calculation for
later replay.

HTTP 422 carries `{code, message}` for configuration, scale readiness, invalid
milk mass, duration limits, non-idle machine, active probe stop or calibration
mismatch. An unloaded plugin is rejected by Decaid with 404 before dispatch.
Handle unavailable plugins and API failures without applying a cached result.

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
  -d '{"smallJugGrams":150,"mediumJugGrams":220,"largeJugGrams":300,"singleDrinkGrams":160,"singleDrinkJug":"small","weightMode":"gross","referenceMilkGrams":150,"referenceSeconds":25,"referenceFlow":1.5,"referenceSteamTemperature":150,"maxSeconds":120}'
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

On the tablet with the companion Streamline skin, verify light/dark appearance,
touch and keyboard dismissal, Auto Calc enable/disable, configuration save and
reload, gross/tared modes and manual jug overrides. Removing or disconnecting the
scale, changing flow or heater target, arming probe stopping, starting another
machine operation, or disabling the plugin between preview and apply must prevent
application. Verify a rejected network write is not shown as success or saved
for later replay. Finally calibrate and validate timed stopping on real hardware
with a thermometer; a simulator cannot establish temperature accuracy.
