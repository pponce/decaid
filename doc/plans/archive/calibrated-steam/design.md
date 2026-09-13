# Calibrated steam extension

This initial dialog design is superseded by [the preset interaction](preset-design.md).

Implement a portable JavaScript plugin under `packages/calibrated-steam`, with an
installable `assets/plugins/calibrated-steam.reaplugin` directory. It is bundled
into Decaid but disabled by default until the user enables it. A separate
Streamline change uses the plugin's calculation endpoint. Both the source and
built plugin live in Decaid so no external plugin repository needs maintaining.

The plugin owns persisted calibration settings, Damian's DSx2 jug-selection
heuristic, milk-weight calculation and validation. The skin owns its existing
scale connection, presents the inferred jug for correction, and explicitly writes
only the calculated steam duration through its normal workflow API. No automatic
steam start, browser-controlled stop timer, or DYE2 data changes are introduced.

Fresh stable gross weights are required for automatic jug selection. Tared mode
uses net milk weight and cannot identify a jug from that weight. Calibration
records milk mass, time, steam flow and steam heater target; mismatched operating
settings require recalibration or restoring those settings. Probe-based stopping
must be disabled explicitly before using time-based calibration.

Streamline replaces the Time/Flow selector with Auto Calc while the plugin is
loaded. Plus/minus adjust duration in this mode; the flow value remains editable.
Opening the calculator previews the result; Use time applies it after rechecking
the scale, configuration and machine state. Plugin disable restores normal UI.

Credit Damian / Damian-AU and link DSx2. Reimplement the documented formula and
heuristic in JavaScript; do not copy Tcl UI code or unlicensed artwork.

Verify formula, both jug heuristics and exact boundaries, tared/manual modes,
invalid configuration, unstable/stale scale data, calibration mismatch, duration
limits, plugin lifecycle and HTTP responses. Verify Streamline enable/disable,
sample-cache retirement, failed writes and normal steam behavior. Actual tablet
and machine verification remains required before a production release.
