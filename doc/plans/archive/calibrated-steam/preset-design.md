# Auto Steam Calculator interaction

The user chose a main-screen Auto mode alongside Flow and Time, replacing the
preview dialog. Four existing-sized presets select Small, Medium, Large or Auto;
each tap calculates and applies, including tapping the remembered choice again.
The settings page belongs under Streamline Settings > Extensions and exposes the
plugin enable control and the plugin-owned calibration form.

Entering Auto and completing a steaming cycle set duration and heater target to
zero, matching Streamline's Off behavior. This is a reminder, not a guaranteed
hardware start lock. A successful calculation applies the configured flow and
heater target together with duration. Manual steam settings are captured before
Auto and restored on exit. Automatic settings are not persisted as manual values;
normal reconciliation must not replay manual values over an active Auto session.

Remember the pitcher choice and enough session state to recover manual settings after
a reload. Reject stale readings and busy-machine operations; defer resets or
restoration until idle when the machine is already running. Keep Damian's exact
pitcher heuristics. Settings own the calibration; the skin owns mode transitions,
workflow application and scale observations. Update the API contract for the
flow/heater patch and document the change for other skins.
