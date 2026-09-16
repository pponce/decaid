# Guided steam calibration

The settings page captures gross weight after taring an empty scale, both for empty pitchers and for pitcher-plus-milk calibration. Capture requires fresh, stable samples and never stores a tared pitcher as its gross weight. Manual entry remains available.

A plugin-owned calibration session prepares duration 255 (the firmware's supported timer ceiling), the user's selected flow and normal heater target, with probe stopping disabled. It records active pouring time, excludes warm-up, and accepts physical or page start/stop. This temporary timer is not a user-configurable maximum. Reaching it produces an incomplete calibration.

The page renews a short ownership lease. Leaving the page or losing contact cancels the run, requests idle if steaming, and restores the prior workflow steam settings after confirmed idle. Machine disconnection or missing telemetry invalidates measurements. The plugin retains restoration ownership until its write succeeds. App termination cannot promise restoration; never save an incomplete run.

Skins consult calibrationActive before Auto writes; calculation is rejected during calibration. Streamline supplies its remembered normal heater target through an optional settings-page URL parameter when Auto has parked the heater Off. Other skins can do the same without depending on Streamline storage.

Save remains an explicit review action and returns to the calling settings location. Guided calibration does not infer pitcher size and always subtracts the selected empty pitcher even if everyday calculation uses tared mode.

Verification: 46 plugin JavaScript tests pass, including generated-plugin host
routing, scale-zero capture, guided form save/navigation, start/cancel races,
telemetry loss and restoration failure. Streamline has 722 passing tests; the
existing Visualizer sample fixture remains absent (one unrelated failure).
Flutter/Dart are unavailable in the development environment. Native plugin and
Android hardware verification remain required on the test build.
