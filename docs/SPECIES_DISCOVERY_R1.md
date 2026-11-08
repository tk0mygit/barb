# Phase 6-E-R1: focus vignette and compass sigil

G0, prepared before implementation (2026-11-08 UTC): new Codex chat;
recommended Codex with high reasoning. The actual remote main and local HEAD both
equal `01621a1b5a2976c561897f9325b05bb9371d92ba` (merged PR #73).
The initial `work` checkout was clean; no open repository PR was returned.
Use the existing checkout and one dedicated branch / independent PR. Preserve
the Phase 6-E specification and its domain/notification contracts. No merge or deploy.

## Change impact matrix

| Boundary | Direct edit | Indirect observation / acceptance |
| --- | --- | --- |
| Game state, probability, clock, species / achievements | None | Existing first-capture trigger, immediate registration and 3,000ms visible deadline stay intact |
| Input adapters, fishing / QTE | None | Store, sale, Esc and touch work through pointer-transparent decoration; fixed rectangles and scroll |
| Camera, renderer, WebGL | None | Compare submitted calls / triangles and live geometry / texture / program counters; zero context loss |
| Discovery DOM / CSS | Vignette and Rare SVG; shared existing lifecycle | Background-only focus, original artwork/text saturation, Rare-only sigil, no residue on end/cancel/recovery |
| Notification coordination / achievement UI | None | Discovery 3s, then each award 5s; interrupted award keeps its remainder; single status announcement |
| Audio / environmental audio | None | Existing Rare short tone, one existing shared context; no new sound or context |
| Save, economy, collection, fish images / cache / secrecy | None | Native production capture and controls, reload silence, failed/delayed image negatives |
| E2E evidence | Extend only the two discovery specs | Keep equipment-game mouse/touch and achievement assertions; viewport / static / staged captures |
| Mobile capture / pixel comparison | None | Preserve all 34 pairs / 68 images and source provenance; full run belongs to CI |
| CI aggregation, CLI / workflows, dependencies | None | L2 Unit/Build, Regular A/B, Mobile and ci-required required; no local full browser suite or CI waiting |
| Network, assets, permissions | None | No additional runtime request, font, image, library, filter, canvas or GL path |

Stop if implementation needs changes outside the approved presentation and its
focused verification/evidence. Full CI, validation-merge parents, physical device
acceptance and deployment remain PM gates; local results cannot establish them.

## Final presentation

The vignette is an isolated background layer (z=0) inside the catch dialog,
outside the artwork's clipping boundary. Existing dialog content uses z=1,
with no positional offsets, while the fixed achievement region retains its
existing positioning. The vignette matches the dialog's visible inner bounds,
including a natively scrolled result, without enlarging its scrolling area. It does not
change `#catch-dialog::backdrop`. The radial focus follows the artwork's horizontal
center and 46% vertical point, measured once on creation and on resize/orientation
events only. The center is transparent through 12% of the ellipse, the 42% stop
uses `#071f2214` (7.84% alpha), and the farthest corner uses `#071f223d`
(23.92% alpha). Image pixels, names, registration and controls paint above it.

Rare adds one non-interactive, aria-hidden SVG behind the existing fish image and
below the original ripple/scan/copy. It has three static paths: short paired
direction marks, fine broken cross axes with four notches, and a small central
record mark. Pale ivory/amber fill `#eee5c8` has a single fine muted ink contour
`#67735b` for contrast against the original pale image frame, with no glow/filter.
The SVG envelope is 94% of the frame width and 80% of its height, capped at 148px;
the central mark is 4% of that envelope's width. The wide, sparse side marks remain
visible beside large fish silhouettes. No second artwork or image loader is used.

| Visible age | Presentation |
| --- | --- |
| 0ms | Existing label/ripple begins; vignette opacity 0 |
| 200ms | Vignette reaches full strength; same strength for ordinary and Rare |
| 500–1,500ms | Existing scan/name staging retained |
| 840 / 885 / 930ms | Rare direction marks / axes / center begin to align |
| 940 / 985 / 1,030ms | Respective line peaks; center peak opacity .95 |
| 1,120–1,320ms | Rare stamp fades to zero (480ms total impression) |
| 1,500–2,500ms | Existing name/number/registration plateau |
| 2,500–3,000ms | Existing notice fade and vignette release |
| 3,000ms | All discovery decorations and animations removed; existing awards begin their 5,000ms turns |

All added WAAPI effects use the same existing 3,000ms duration, visible-time sync,
pause/resume, cancellation and disposal. No new timeout or animation callback is
added. Reduced motion shows static vignette and static Rare paths for the same
three seconds, with no animation. Hidden/blur/pagehide hide all three roots; SVG
uses an explicit hidden attribute so the existing global hidden rule applies.

## Verification record

The final runtime commit and source tree are recorded with the final local results.

Retained initial diagnostics and corrections:

- Normal sandbox npm/network, preview listening and Unit fixture subprocesses
  failed (proxy access, listen EPERM and spawnSync EPERM). The same commands run
  through the approved execution route; no dependency/CI/test policy changed.
- An existing historical comparison commit was absent locally. Fetching main and
  the exact historical fixture commit restored it; baseline main did not change.
- The first static-layout fixture used a large Rare that also unlocked the
  length award. Use a small Rare to preserve the existing single five-second
  queue assertion; do not force/show/shorten notifications.
- A new backdrop expectation assumed a different browser alpha serialization.
  Compare the exact before/after computed value instead; backdrop CSS is unchanged.
- Initial visual capture hid a small central stamp beneath the silhouette and
  existing heading/scan. Widen only the sparse direction marks while retaining
  the behind-artwork layer, three paths and three effect timelines.
- Native button hover contributes its existing -2px transform. Move the pointer
  off both actions after each catch and wait for their existing transform to
  settle before strict before/after geometry comparison.
- A fake clock's second catch can lead the real compositor clock. Resolve WAAPI
  pending pause tasks before seeking. Compare the vignette at 0/1,500ms using its
  paint timeline; no queue, game state or notification expiry is assigned/reset.
- Software-rendering 600 simulated milliseconds can exceed an award's five wall
  seconds. Align its paint to that observed JS age while retaining the exact
  opacity and 5,000ms expiry assertions.
- The fixture loads its CSS link in body, after head-injected styles. Verify
  actual safe inset values with the more specific `html:root` rule; do not count
  an overridden declaration as a safe inset check.

Prior diagnostic outputs remain in `test-results/r1-discovery-initial`,
`test-results/r1-discovery-refined` and `/tmp/barb-r1-*.log`; they are not committed.

## Final local result and pending acceptance

Runtime: `feee19f78ffa46ce3b7d542924a502d70f1b011a`.
Source tree: `d142470056ab348ee79e522c12fe519773cfb5bf`.
Subsequent commits contain only the two focused Browser specs and this evidence
document. The actual remote main still equals the G0 baseline.

| Changed file | Purpose |
| --- | --- |
| `src/ui/species-discovery-notice.js` | Two owned decoration roots, three SVG paths, existing timing/lifecycle, start/resize geometry |
| `src/ui/style.css` | Protected background/foreground layers, radial focus and static SVG styling |
| `tests/browser/species-discovery.spec.js` | Timeline, pixels, verified insets, geometry, Rare rotation/motion/early-close and the retained short-layout failure |
| `tests/browser/species-discovery-production.spec.js` | Native artwork/audio/3s→5s and exact resource/residue checks |
| `docs/SPECIES_DISCOVERY_R1.md` | G0 impact matrix, specification, diagnostics and acceptance evidence |

No unplanned source files changed. The existing classifier returns **L2**, selecting
all **43/43 Browser specs** for CI. That classification is not a CI execution result.

- `npm ci`: PASS, 21 existing locked packages; no dependency changes.
- `npm test`: **1,179/1,179 PASS**, no fail/skip/cancel/todo; 117.02s on final runtime.
- `npm run build`: PASS, 100 modules; existing Three.js chunk-size warning only.
- `git diff --check`: PASS.
- Final selected Browser run: **47 PASS / 1 FAIL**, 48 distinct cases, no retry,
  skip or flaky classification (345.28s). This is not a full Browser suite PASS.
  Only discovery, production discovery, achievement-notice, equipment-game and
  the two smoke specs ran. All other Browser specs remain unexecuted locally.
- **Regular B recurrence prevention: equipment-game mouse PASS / touch PASS**,
  including the real first capture, discovery/award boundaries and opacity/host,
  sale, upgrades, active-fishing read-only checks, persistence and reload. The
  existing equipment spec and its assertions were not edited.
- Both built native capture cases PASS, including original artwork decode,
  QTE/capture/save, discovery then full five-second award, audio and reload silence.
- Discovery's exact three seconds, ordinary absence/Rare-only SVG, fade cleanup,
  existing award remainder/order, immediate store/sale/Esc, image delay/404/decode,
  hidden/blur/pagehide recovery, context loss/disposal, live motion changes and
  rotation PASS. The static layouts, all real-time compositor cases, and animated
  1000×700 / 320×568 / 390×844 / 844×390 cases PASS, with verified synthetic safe
  insets and 20px root text. Pixel checks retain the center and dim the surroundings;
  result rectangles/scroll and pointer hit targets stay unchanged.

The sole failure is **568×320 animated layout**: discovery name and registration
are outside the visible dialog after its existing focus scroll. Independently
loading the G0 main's exact CSS and discovery module reproduces the same result.
With actual safe insets 12/8/14/8px and 20px text, both main and R1 have identical
270px dialog height, scrollTop 208, image top -95px, discovery-name top -31.6px,
registration top -10px, and action rectangles. Even the no-inset comparison fails
identically in both versions (scrollTop 182). No assertion is skipped or relaxed
to turn this acceptance failure into success.

Changing the existing dialog height/button coordinates/scroll would exceed the
task's invariant 4. PM has been asked whether to preserve the fixed layout and
submit this known limitation or authorize a short-landscape layout adjustment.
That decision is pending; no push, PR, CI, merge or deployment has occurred.

### Resource observations

Linux Chromium 154.0.8037.57, ANGLE/Vulkan SwiftShader; built capture at 800×600 CSS
pixels and DPR .5. Final Unit and Browser runs were sequential. The first combined
run had a mouse timeout in its second FIGHT while Unit ran in parallel; its
discovery 0/1,500/2,999/3,000ms and five-second award checks had already passed.
The same mouse case completed in 81.9s without concurrent Unit, and both mouse and
touch completed in the final run. The initial failed trace and timing sequences
are retained; this is not labeled known CI noise.

| Metric | Phase 6-E recorded ordinary / Rare | R1 ordinary / Rare |
| --- | --- | --- |
| Temporary DOM including all decoration roots | 14 / 16 | 15 / 21 → 0 / 0 |
| Discovery WAAPI | 6 / 7 (same original effects) | 7 / 11 → 0 / 0 |
| Added SVG paths | 0 / 0 | 0 / 3 → 0 / 0 |
| Calls / triangles per submitted frame | 27 / 275,164 | 27 / 275,164, unchanged |
| Live geometries / textures / programs | 27 / 4 / 13 | 27 / 4 / 13, unchanged |
| Added requests / AudioContexts / observed context loss | 0 / 0 / 0 | 0 / 0 / 0 |

The normal result, active discovery and post-discovery counters match for both
native cases. There is one shared AudioContext; Common starts no oscillator and
Rare retains its existing one short sine cue with ambient loops OFF. Renderer
memory counters do not measure GPU-memory bytes. No FPS or CPU/physical-device
performance improvement is claimed; CDP windows differ and are diagnostic only.

### Evidence and remaining gates

Local comparison page: `test-results/r1-review/index.html` with ordinary/Rare,
before/200ms/1,030ms/3,000ms, PC/portrait/landscape, explicit missing captures for
the failed short case, and the main/R1 baseline comparison. JSON alongside it
records the exact current case outcomes, resource counters and equipment timing.
Original final-run files and failure trace remain under `test-results/r1-complete`.
Images and generated reports are not committed.

Required L2 Unit/Build, Regular A/B, Mobile 34 pairs/68 images and `ci-required` on GitHub Actions,
validation-merge parents, missing/skip audit, and physical PC/Android acceptance
remain unverified. User PM alone can merge/deploy. No probability, QTE, save schema,
fish asset, audio lifecycle, CI/comparison infrastructure, permission or secret
was changed or exposed.
