# QTE device acceptance record — Phase 5C-2-ON-1

On 2026-10-31, user-PM explicitly authorized **public QTE ON** and a separate
5C-2-ON-1 implementation/validation PR based on main
`dae7faa0585343e751eb63e6eebe648f7101fe42` (PR #54). Its public initializer
enables new and restored games. The prior device report confirmed ordinary
**OFF** behavior only; ON-specific device acceptance below is **unmeasured**.
PR submission and the final public-release decision are separate gates.

Record each platform independently against the actual approved build and,
after deployment, the real public Pages entry. A controlled local composition
may retain internal diagnostics for measurements. No player/URL/storage/global
switch or diagnostic route is published.
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
| Ordinary ON new / V1 / V2 launch and revisit; idle HUD hidden, next fight ON | unmeasured | unmeasured |
| Explicit test-only OFF still has no QTE HUD / handlers; return to public ON | unmeasured | unmeasured |

For each anomaly record expected/observed outcome, fight ID / species / length /
provider seed key, QTE index and operation, source and receipt times, A/D/C,
reasons/geometry revisions, original slot hashes, console and video, exact input
sequence and reproducibility. Record ON fight duration with normal physics,
warning, display waiting, operation, receipt wait and intentional pauses split.
Compare 30/60/144Hz and long-frame observations without shortening any window.

PM numerical decision (unrecorded): retain/revise 100ms; retain/revise 128 edges, including
controlled 64/128/256 diagnostic comparison before changing the product value;
platform-specific acceptance and unresolved anomalies. If a value changes,
record the approved specification revision and required new PR / L2 validation.

The ON authorization permits this PR; it does not certify all three devices or
the product suitability of 100ms/128 edges. The latter values remain unchanged
and provisional. 8th_PM must review the current-HEAD full L2 Regular/Mobile
evidence (34 comparisons / 68 images), validation-merge parents, source/artifact
hashes and `ci-required`. User-PM alone decides merge and final release after
reviewing device acceptance and remaining gaps. If user-PM separately elects to
release without measurements, record that decision without calling it measured.
Codex stops at the PR URL, without CI polling, merge, deployment or device signoff.

After deployment, PC mouse / Android Chrome / iOS Safari public ON checks remain
required: four operations and directions, shortest0.5s / 3tap2s, visual warning,
A/D/C, normal input recovery, menu/RESULT/audio ownership, rotation/lifecycle,
capacity/latency, catch0–3, all sales and V2 revisit. Preserve original failures.

For a serious public ON regression, open a **new revert PR** against the healthy
main immediately before the enablement merge, with L2 review and user-PM merge.
Revert only this enablement change; preserve both save slots and never delete,
reset or rewrite player saves. The previous PR #54 runtime already reads/writes
V2 and count0–3. Validate that runtime against actual ON-generated V2 before
rollback, including old V1/V2, historical price/wallet/award dates and slot raw
protection. A V1-only writer is not a compatible rollback target.
