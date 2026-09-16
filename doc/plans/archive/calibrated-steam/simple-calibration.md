# Simplified calibration

Review of Damian-AU/DSx2 code/procs_vars.tcl, skin_steam_time_calc (lines
1544–1601 at review), confirms a milk-weight/time ratio with pitcher subtraction.
The function does not read heater temperature to adjust time, record a calibration
heater value, or use a separate maximum-duration cap.

The settings expose calibration milk weight, time and flow. There is no heater
calibration field or user-configured maximum duration. The calculator returns
only duration and configured flow; heater handling belongs to the skin.

Streamline still needs operational heater restoration because its agreed Off state
writes both duration and targetTemperature to zero. It restores the normal target
from the existing manual-settings backup, or reads the normal remembered setting
when Auto was entered from manual Off. This is ordinary enable/disable behavior,
not a calibration record or temperature-dependent estimate. If no normal target is
known, leave Off and ask the user to set it in normal Steam settings.

Tests cover the supported 255-second boundary, identical time estimates at
different heater temperatures, normal heater restoration and missing-heater failure.
