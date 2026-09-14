# Compact Auto Steam settings and navigation

Use General, Pitchers & Auto, and Calibration tabs, with separate pitcher availability and calibration-readiness summaries. Both flow inputs edit one draft setting. Pitcher capture buttons are siblings of labels, with stable-scale requirements and feedback beside the action. Guided calibration keeps its existing host-owned session and reports blocked steps locally. Short milk errors identify the selected or inferred pitcher in grams.

Keep one Auto session for the Streamline application lifetime. Leaving the main page invalidates a prepared calculation and requests one background Off reset. Coalesce reset requests before any asynchronous reads, compare confirmed settings before rewriting, and retain completion across ordinary navigation. Reconnect and real configuration changes trigger revalidation. Do not refresh merely because the user focuses the app or visits settings. Navigation never waits for machine writes. Actual machine failures remain visible when relevant; background failures do not produce misleading contention popups.

The physical machine Steam button remains unchanged. No flow-based time compensation is introduced.

## Verification

The generated plugin and settings browser tests pass (50 tests). Streamline reports 732 passing tests and one pre-existing failure caused by the unavailable Visualizer Tcl fixture. Regression tests cover duplicate resets, rapid navigation, cancellation during calculation, retry after a real failure, cached page returns, configuration changes and reconnection. JavaScript syntax checks and OpenAPI YAML parsing pass. Dart/Flutter formatting, analysis, tests and app smoke tests could not run because the SDK is unavailable. Android/WebView visual and physical-machine checks remain to be performed on the test build.
