# Simplified calibration

Review of Damian-AU/DSx2 code/procs_vars.tcl, skin_steam_time_calc (lines
1544–1601 at review), confirms a milk-weight/time ratio with pitcher subtraction.
The function does not read heater temperature to adjust time, record a calibration
heater value, or use a separate maximum-duration cap.

At the user's request, plugin v0.4.0 removes referenceSteamTemperature and
maxSeconds from the schema, validation and calculations. Older stored values are
ignored. The supported 1–255-second timer range remains; this is not a user setting.
Calculator API v3 returns only duration and configured flow, and requires no heater
or flow observation. Host manifest API version remains 1.

Streamline still needs operational heater restoration because its agreed Off state
writes both duration and targetTemperature to zero. It restores the normal target
from the existing manual-settings backup, or reads the normal remembered setting
when Auto was entered from manual Off. This is ordinary enable/disable behavior,
not a calibration record or temperature-dependent estimate. If no normal target is
known, leave Off and ask the user to set it in normal Steam settings.

Tests cover times above the removed 120-second default, the supported 255-second
boundary, identical time estimates at different heater temperatures, absent form
fields, ignored old settings, normal heater restoration and missing-heater failure.
