# Multiple-flow Auto Steam calibration

Keep existing settings as single-flow calibrations. Add an opt-in multiple-flow calibration with two to four measured flow/milk/time readings. Normalize each reading to seconds per gram and interpolate linearly between adjacent flows. Reject requests outside the measured range; never extrapolate. The default Auto flow can change within that range without discarding measurements.

The approved compact Calibration tab offers Single flow and Multiple flows. Multiple flows asks for minimum, maximum, count (three recommended), target milk weight and default flow, then guides the user through evenly spaced readings. Each reading accepts manual measurements or the existing host-owned guided run. Every guided run applies and verifies its specific flow before Start is available. Capture fresh milk each time, retain readings only in the draft, and save the complete calibration atomically. Preserve prior saved configuration until Save.

Store the readings as a JSON string in the plugin's supported string setting type; expose parsed range/readings through an additive API v3 status capability. Keep the existing single-flow fields and request defaults compatible with older skins.

In Streamline, single-flow Auto hides both adjustment buttons. Valid multiple-flow Auto exposes them for flow changes within the calibrated range, resets duration to Off and requires another pitcher tap. Manual Flow and Time retain their normal controls. Preserve background reset coalescing and manual-setting restoration.

No workflow dispatch, release, main merge, physical-button auto calculation or changes to pitcher inference are included. Publish the approved changes to the existing feature branches for Android testing.

## Verification

61 plugin tests pass, including interpolation endpoints/segments, invalid calibration data, settings round-trip, the multiple-reading page, fresh captures, and the preparation/start flow gate. Streamline reports 739 passes and one pre-existing missing Visualizer Tcl fixture failure; focused coverage includes requested-flow validation, Auto adjustment bounds, Off invalidation, manual restoration, reload and existing navigation races. Both OpenAPI documents parse, including the skin's plugin contract references. JavaScript syntax checks pass. Dart/Flutter formatting, analysis, tests and app smoke checks are unavailable because the SDK is absent. Android/WebView and physical-machine verification remain for the user's test build.
