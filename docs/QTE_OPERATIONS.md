# QTE operations and visual display boundary (5C-2-2)

The standard new game and save restoration still leave QTE disabled. This phase
adds opt-in modules; `main.js`, fishing physics/RNG, catch records, prices and
the V1 save writer are unchanged. Full production composition is a later gate.

| Layer | Direct change / indirect observation | Verification |
| --- | --- | --- |
| State / physics / operation selection | New pure scorer and independent seeded provider; existing physical constants, reservations and draws unchanged | Scorer boundaries, golden vector, distribution diagnostic, encounter/RNG and existing FIGHT tests |
| Input / canvas owner | Delivery carries down-time pointer type and frozen CSS geometry; exposes read-only preview evidence | Original 50 delivery tests, source/cut, cancellation, epochs, checkpoint and overflow tests |
| QTE HUD / display epoch | New opt-in HUD and free-space layout; scoped CSS, no interactive target owner | Trusted mouse / Chromium touch through controls, display, scoring, seal and one commit; safe inset / rotation / menu tests |
| Existing HUD / camera / rendering | Existing components unchanged; shared stylesheet gains QTE-only selectors | Production PC/touch smoke, fishing, mobile layout, audio/focus tests |
| Regular E2E | New spec and test-only composition routes | Exact collection and selected local execution; all Regular required by L2 CI |
| Mobile capture / comparison | No changes to capture IDs, source replay, image or resource rules | Existing comparison unit tests; 34 pairs / 68 images remain required by CI |
| `ci-required` / CLI | No changes to workflows, collection/aggregation or CLI exit semantics | Existing aggregation and negative CLI tests; actual CI verdict separately reviewed by PM |

`qte-operations.js` takes explicit immutable evidence in active milliseconds and
client CSS pixels. The four scorers require a complete, uncancelled down/up with
matching identity, pointer type and geometry revision. Source endpoints include
A and D; receipts exclude C. Wrong gestures can retry inside the same window.
Flick/swipe use endpoint displacement; tap uses the maximum displacement from
all delivered/coalesced movement. No predicted events or compatibility clicks
are evidence. Unknown/pen pointer types fail closed.

`createQteEvaluator(provider)` consumes delivery's
`{ handle, window, previous, edges, completedOperations, final }`. Preview is
provisional, including 3/3; it does not modify domain successes. Only the closed
cut commits. Interruption checkpoints preserve a bounded count/success and
serial watermark, never a partial gesture or an unbounded log. Re-evaluation
of the same serials does not add completed taps. A sufficient checkpoint remains
successful even when a subsequent overflow has no remaining operation time;
missing evidence without that checkpoint still resolves to one failure.

`createQteOperationProvider({ fightId, speciesId, lengthCm })` returns immutable
descriptors plus the existing string-returning `selectOperation({ index })`.
The versioned seed key is a JSON tuple of fight ID, NFC species ID and integer
length in tenths of a centimetre. FNV-1a over UTF-16 code units seeds nonzero
xorshift32; rejection-sampled Fisher–Yates selects a permutation, followed by
directions for flick/swipe. Descriptor access never redraws. It calls no
`Math.random`, date, clock, fishing RNG or storage API. Fixed diagnostic counts
are reproducibility checks, not device acceptance or a uniformity proof.

`prepareDisplay(frameId, rawTimestamp, geometry)` extends the existing API with
an optional third argument. Transport-only consumers may omit it. The HUD
supplies `{ region, target }`; delivery validates/copies/freezes it and stamps
the current revision. Each contact retains that exact geometry and down-time
`pointerType`, primary flag and button. The scorer never reads live DOM bounds.
`preview()` is read-only and does not checkpoint or seal.

`createQteHUD({ fishing, delivery, provider, canvas, root })` is constructed only
by the test composition in this phase. Its caller opens delivery with the
warning source anchor and calls `hud.update(frameId, performance.now())` once
per rendering opportunity. Geometry is prepared before a later frame can
present it; all 0.6s of warning must elapse before A opens. A browser rendering
opportunity is not proof that a physical display emitted light.

The HUD avoids visible masthead, action/fishing panels, compass and notices,
intersecting canvas, safe-area and visual viewport bounds. Short landscape
uses a compact side-by-side layout. Both mouse32 and touch40 target circles
are visible on hybrid devices. All HUD descendants use `pointer-events:none`;
the actual input owner remains `#scene`. Insufficient room is an explicit
layout diagnostic and cannot prepare a successful display. Warning, active,
receipt wait, result, interruption and resume wait use text and shapes.

Orientation invalidates contacts and freezes time until re-presentation; minor
resize/obstacle changes invalidate geometry without extending D/C. Lifecycle
reasons still belong to delivery's existing reason set. The composition owns
technical resume (`hud.resumeTechnical(raw)`), menu/focus/page wiring and domain
advancement. `dispose()` removes the opt-in HUD's resize/orientation listeners.
No production URL query, setting, hidden switch or test fixture is published.

The 100ms grace and 128-edge capacity remain development defaults. Real PC,
Android Chrome and iOS Safari input/visibility/latency/capacity measurements,
full production composition, sales/save migration and product enablement are
separate gates. Playwright Chromium touch is not real Android/iOS acceptance.
