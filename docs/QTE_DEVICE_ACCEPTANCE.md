# QTE device acceptance record — Phase 5C-2-4

Product QTE remains **OFF**. This form does not authorize enablement. Record
each platform independently using a controlled local test composition of the
actual application. Do not publish an ON route, URL switch or player setting.
Chromium touch emulation, synthetic events and software WebGL cannot replace
PC / Android Chrome / iOS Safari acceptance.

The development receipt grace is **100ms**, semantic edge capacity **128**.
Both are provisional. No measurements below have been performed by Codex.
Use **unmeasured**, never `0 failures`, for an unperformed measurement.

| Record | PC mouse | Android Chrome | iOS Safari |
| --- | --- | --- | --- |
| Tester / date / session ID | unmeasured | unmeasured | unmeasured |
| Device / OS / browser and full version | unmeasured | unmeasured | unmeasured |
| Base / PR HEAD / tested source SHA and local artifact hash | unmeasured | unmeasured | unmeasured |
| Screen CSS px / visual viewport / safe insets / zoom / DPR | unmeasured | unmeasured | unmeasured |
| Portrait / landscape / browser bars / rotation | unmeasured | unmeasured | unmeasured |
| Physical refresh rate / observed rAF rate / CPU load | unmeasured | unmeasured | unmeasured |
| New / V1 / V2 / original slot hashes and generations | unmeasured | unmeasured | unmeasured |
| Audio preferences / unlock / focus history | unmeasured | unmeasured | unmeasured |
| Video / console / input evidence / reproduction links | unmeasured | unmeasured | unmeasured |

Use one row per operation, direction, viewport and load condition. Preserve
failures and subsequent retests separately; do not replace the original row.

| Scenario | Attempts | Correct accepts | Incorrect rejects | Incorrect accepts | Source→receipt p50/p95/p99/max ms | Edge peak / overflow / technical | Display preparation delay ms | Evidence / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| flick up/right/down/left | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured |
| swipe up/right/down/left, at least 75px safe space | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured |
| shortest non-tap window 0.5s | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured |
| tap 3 times / 2s; retry, returned drag and checkpoint | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured |
| target boundary: mouse32 / touch40 CSS px | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured |
| pre-display / warning contact rejected; fresh contact required | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured |
| source A/D inclusive, receipt C exclusive; delayed/old up | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured |

Incorrect rejection rate = incorrectly rejected valid attempts / valid attempts;
record the numerator and denominator. A bounded ring is a diagnostic sample,
not a population distribution. Export successive samples during the test and
deduplicate only by actual ingress identity; do not infer missing observations.

The application keeps delivery diagnostics in the internal composition object,
without a public global, setting or console command. A local acceptance harness
may retain that return value, as the Playwright route does. `qteDelivery.snapshot`
contains the last 32 source→receipt delays, maximum observed delay, semantic
edge peak, bounded rejection/interruption counters, the last 32 diagnostic
reasons, and warning-to-A delay beyond 600ms. Source and receipt refer to the
same window's monotonic clock. A later rendering opportunity is not proof of
screen emission; align video to the actual visual change separately.

| Lifecycle / outcome check | Result | Evidence |
| --- | --- | --- |
| Warning → presented geometry → gesture → one cut → normal fresh hold | unmeasured | unmeasured |
| Menu + blur + hidden + pagehide, both release orders; BFCache pageshow | unmeasured | unmeasured |
| Pause preserves remaining time, completed taps, fish and reservation | unmeasured | unmeasured |
| Rotation re-presents geometry; small resize does not extend D/C | unmeasured | unmeasured |
| Single finger, secondary mouse button, pointercancel/lost capture | unmeasured | unmeasured |
| No normal-load overflow; deliberate overflow shows explicit canvas restart | unmeasured | unmeasured |
| Technical recovery preserves remaining budget; zero-time case resolves once | unmeasured | unmeasured |
| Repeated interruption cannot award extra time; sufficient checkpoint preserved | unmeasured | unmeasured |
| Fish defeat / abort / recast / next fight leaves no contacts or old tokens | unmeasured | unmeasured |
| Catch counts 0/1/2/3, bonus and immediate/individual/bulk sale | unmeasured | unmeasured |
| V2 save → fresh session; old prices/wallet/achievement dates retained | unmeasured | unmeasured |
| Loading writes nothing; V1 active raw retained on first V2 save | unmeasured | unmeasured |
| Menu / RESULT / audio controls receive their own native inputs | unmeasured | unmeasured |
| ON test session → ordinary OFF launch / restore has no QTE HUD or ON state | unmeasured | unmeasured |

For each anomaly record expected/observed outcome, fight ID / species / length /
provider seed key, QTE index and operation, source and receipt times, A/D/C,
reasons/geometry revisions, original slot hashes, console and video, exact input
sequence and reproducibility. Record ON fight duration with normal physics,
warning, display waiting, operation, receipt wait and intentional pauses split.
Compare 30/60/144Hz and long-frame observations without shortening any window.

PM decision (unrecorded): retain/revise 100ms; retain/revise 128 edges, including
controlled 64/128/256 diagnostic comparison before changing the product value;
platform-specific acceptance and unresolved anomalies. If a value changes,
record the approved specification revision and required new PR / L2 validation.

Product enablement requires all three device acceptances, current-HEAD full L2
Regular/Mobile evidence (34 comparisons / 68 images), final `ci-required`, review
of saved-data protections and explicit user-PM authorization. Enabling the
shipping initializer requires a separate enablement PR and L2 run. This phase
does not implement or perform that change.
