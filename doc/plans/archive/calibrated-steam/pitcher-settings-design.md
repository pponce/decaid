# Pitcher setup and settings navigation

The Android test exposed a dead-end standalone settings form and an unusable
embedded settings page. Use normal page navigation from both Streamline entry
points. The plugin takes a validated same-host `returnTo` URL, so navigation works
for other skins without the plugin knowing their routes. Save returns only after
successful validation and persistence; errors keep the form open.

One configured pitcher plus calibration is sufficient for manual size selection.
Unused sizes are 0 and excluded from status.availablePitchers. Automatic detection
is a separate explicit opt-in, requiring all three weights, usual milk per drink,
the normal one-drink pitcher and gross weighing. Damian's thresholds use the small
and medium weights and can select any of the three; requiring all three preserves
that algorithm instead of inventing a new inference for incomplete weights.

The top-level Auto steam mode is distinct from automatic pitcher detection. It
remains available when the plugin is enabled, even without calibration, but starts
Off and cannot calculate until setup is valid. Manual steam settings remain backed
up and are restored on exit. Removed saved pitcher selections fall back to the
configured default; stale taps are revalidated before any calculated settings write.

User-facing text says pitcher; compatibility keys retain jug spellings to preserve
saved data and existing consumers. Plugin v0.3.0 adds status.availablePitchers while
retaining calculator API v2 and the Decaid host manifest API v1.

Auto-mode flow defaults to 0.4 ml/s and accepts 0.4–2.5 ml/s. An old unset
value of 0 migrates to the default; existing nonzero values remain visible for
review and are validated against the new range. Manual flow controls are unchanged.
