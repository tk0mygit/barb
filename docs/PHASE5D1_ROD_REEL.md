# Phase 5D-1: static levelled rod and reel

## PM-approved B revision (2026-11-02)

The user PM explicitly approved the rotated-FIGHT draw-call specification
revision after the recorded stop: old `<40`, observed main39 / 5D-1 implementation41,
new absolute limit **<=41**. Only that assertion in
`tests/browser/mobile-performance.spec.js` changes. A Unit exercises its actual
Playwright matcher:41passes and42fails. The other rendering `<40` assertions,
resolution, texture/program/geometry checks, exact-source comparisons, capture
IDs, timeout/retry/skip rules and all CI contracts remain intact.

This approval is specific to this addition. The absolute41cap does not increase
for5D-2 or later PRs, and the introduction's source-verified resource delta is not
a recurring allowance for later model-to-model changes. Existing-rendering
optimizations are outside this PR.

Re-G0 verified unchanged remote/main and origin/main at
`936210d2d118e4e66e2e4426a198d626f84742e8`, saved branchHEAD
`ae579e0361cc44cbbf7cb996f9d33587fc478bcb`, clean worktree, no remote work branch
and no openPR. Its product source tree matches measured implementation
`b5bcf71a6b7aea9390e5ca1aa66c8519cdce99be` exactly. This existing Codex chat
continues the authorized5D-1 PR; recommended setting remains Codex Ultra.

## Scope and G0

- Approved base main: `936210d2d118e4e66e2e4426a198d626f84742e8`.
- Existing checkout `/workspace/barb`; branch `codex/p5d1-rod-reel`.
- Initial G0 stopped because local HEAD and origin/main differed from the approved base.
  On explicit PM restart authorization, `ls-remote`, `fetch --no-tags origin`, a new
  branch from the approved commit and another `ls-remote` verified all three SHAs.
  The working tree was clean and open PR count was zero. Existing `work` and
  `feat/barb-initial-game` were retained; no reset, clean or additional worktree.
- This existing Codex chat continues the authorized 5D-1 implementation only.
  Recommended setting: Codex Ultra. No merge, deployment or 5D-2 work.

## Impact matrix

| Layer | Direct change | Indirect verification / final gate |
| --- | --- | --- |
| Equipment / game state | Canonical `collection.equipment` read and subscription only | Purchase and V1/V2 restore; immutable prices, abilities and cast snapshots |
| Input / QTE / clock | None | Native mouse/touch, QTE presentation/target and normal clock contracts |
| Camera / rendering | New factory and scene-owned static view; additive main connection | Existing rig and preparation run first; READY/AIM/CAST/FIGHT, resize and high DPR |
| Line / lure | None | Existing virtual origin and line algorithm; matching tip projection |
| UI / save / sale / audio | None | Existing DOM/safe areas, paused-menu purchases, restore and normal lifecycle |
| Unit / Regular E2E | New focused tests and exact shader-cache ownership check | All levels, resource identities, canonical sync, native phases and context loss |
| Mobile capture / comparison | Exact-source introduction verification and the PM-approved rotated-FIGHT <=41 assertion only | Same 34 IDs / 68 images, both real SHAs, exact observed resource deltas |
| CI aggregator / CLI / workflow | None | Existing awaited comparison paths, three-lane exact union and `ci-required` |

## Models and ownership

`rod-reel-model.js` creates distinct rod/reel Groups and Meshes. They own one
fixed-capacity BufferGeometry each and share one lure-compatible, fog-aware
vertex-color MeshBasicMaterial. Low-poly primitive templates are extracted once
per factory, and all intermediate geometries are disposed immediately. No texture
or external asset is added. Vertex colors include simple fixed face shading.

Level changes copy transformed shared primitive data into the existing position
and color arrays and set the active draw range. There are no 20 complete cached
models. Same-level selection changes neither attributes nor versions. Validation
checks both integer levels 1–10 before changing either model. Unit exercises all
100 level pairs three times with zero new Geometry, Material or Object3D IDs.

The view owns the collection subscription and the factory lifetime. Its idempotent
dispose unsubscribes, detaches the root, and disposes the two geometries and one
material exactly once. Context loss and startup failure use this disposal path.
The existing context-loss reload screen remains the recovery behavior.

The live position/color buffer capacity totals 144,000 bytes, excluding ordinary
Three.js object overhead and small shared CPU templates. This is not GPU byte
usage. GPU geometry/resource counts must be measured through the renderer.

## Twenty visual identities

The following table is generated from the factory's active draw ranges and
`ROD_REEL_APPEARANCES`. Unit also hashes only active position bytes: all ten rod
hashes and all ten reel hashes are distinct without using color differences.

| Band | Lv | Rod structure | Reel structure | Rod triangles | Reel triangles | Total |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| I | 1 | Thin blank, straight grip, three guides | Small round housing, plain spool | 288 | 200 | 488 |
| I | 2 | Four guides, flared end cap | End fin, spool end collar | 372 | 260 | 632 |
| II | 3 | Two-tone sections, reinforcement sleeve | Faceted housing, raised side panel | 396 | 216 | 612 |
| II | 4 | Paired collars, faceted end cap | Paired shoulders, chamfered rim | 492 | 240 | 732 |
| III | 5 | Split grip, five-guide blank | Spool shroud, three ribs | 480 | 300 | 780 |
| III | 6 | Contoured butt, three raised ribs | Elongated housing, five shroud ribs | 516 | 324 | 840 |
| IV | 7 | Slender shaft, double-foot guides | Slim housing, stepped rim | 576 | 264 | 840 |
| IV | 8 | Forked tip support, pointed cap | Crown rim, open bridge | 608 | 304 | 912 |
| V | 9 | Premium grip, paired rings, six guides | Precision double rim, twin side panels | 744 | 336 | 1080 |
| V | 10 | Sculpted butt, triple rings, seven guides | Triple rim, split bridge, perimeter lugs | 924 | 432 | 1356 |

Two draws and at most 1,356 triangles leave two draws / 1,144 triangles within
the provisional combined 5D-1 + 5D-2 budget. The separate 5E-1 reservation remains
untouched. These are model submission counts, not a claim of real-device FPS.

## Static display contract

The camera remains outside the scene. The scene-owned root copies its world pose
after the existing rig/preparation update, including synchronous resize renders.
No camera transform, FOV, near/far, ownership or fishing physics is changed.

The model tip projects to 58% width / 57% height, independently matching the
existing virtual camera-local line origin one metre ahead. The original line
formula is unchanged. The grip's perspective-scaled position keeps the entire
assembly within the four requested viewport profiles at every level.

| Screen / state | Rod and reel behavior |
| --- | --- |
| Sailing TPS | Hidden; levels still synchronize |
| READY, AIM, CAST, LURE, BITE, FIGHT, LANDING | Same static view-relative pose |
| RESULT, FAILED | Hidden, consistent with the existing fishing visual/result handling |
| Collection menu | Last rendered fishing pose remains behind the native modal; purchases synchronize the CPU model immediately, then appear on the next ordinary render |
| Context loss | Root detached and owned resources disposed; existing reload error shown |

READY's portrait controls can cover the lower equipment. AIM evidence additionally
shows the same pose with the ordinary cast controls. DOM/HUD remains above WebGL;
the model adds no input target. Bounding-box overlap reports do not claim that
the diagonal rod fills every pixel inside its rectangular envelope.

## Mobile comparison preservation

Except for the one PM-approved rotated-FIGHT cap, `mobile-performance.spec.js`,
the existing capture IDs, thresholds, root fixtures, workflow and CI aggregator
are unchanged. The new verifier loads the actual
factory and view from both exact Git SHAs. Only the absent-to-present introduction
from the approved base receives a resource delta. All other product paths and
build inputs must match; reversing the complete additive main connection must
recover the base main exactly. Model-to-model future PRs receive no recurring
allowance from this introduction.

The factory's actual draw ranges determine the Lv1 delta: two calls and 488
triangles in the 14 fishing captures, and two warmed geometries in every capture
because the existing diagnostic warmup visits hidden objects. Texture/program
counts, buffers, DPR, camera, HUD and every other resource remain exact. Both
fixed diagnostic and actual production-view counters are checked.

The existing awaited source comparison remains shared by capture, report, final
aggregation and CLI. Synthetic local gate probes verify 34 pairs / 68 synthetic
images, negative provenance/resource cases and CLI exit 0/1. These probes are not
browser measurements or GitHub CI success. Actual PR L2 must still verify the
two-parent validation merge, same build artifact, all selected test IDs exactly
once across three lanes, no skip/retry/flaky/expected-fail, and final `ci-required`.

## Validation record

Final local results and image references are recorded below after execution. Full GitHub L2 and real devices are
not run or monitored by Codex. Local evidence under `test-results/` is generated,
not a runtime asset; raw screenshots and traces are not committed wholesale.

Initial diagnostics retained (later success does not erase these failures):

- At measured source`b5bcf71a...`, the original Mobile comparison passed main
  but failed thePR rotated-FIGHT assertion:39calls versus41, original cap`<40`.
  Its diagnostics/trace remain in`test-results/p5d1-mobile-threshold/` and raw
  captures in`test-results/p5d1-mobile-threshold-evidence/`. No threshold was
  changed until the explicit B approval above. This was an absolute-test-contract
  conflict; the model itself remains within the approved provisional GPU budget.
- The first new16-case browser run did not complete:3PC appearance passes,
  3portrait bound failures,1interruptedlandscape case,9notrun. At the stop, the
  corrected full16cases, relatedregular cases, completeMobile34pairs, L2 and
  devices were still unverified. New local execution is recorded separately.

- First new model Unit exposed a missing crank-hub structural detail; the model
  gained its actual crank support and the test passed without relaxing assertions.
- First full Unit run: 1002 passed / one file failed because the existing scenery
  test referenced locally missing commit `eb10aa13ec302a7a4c9b4a421a596f447c8f6e7c`.
  Fetching that exact commit restored the unchanged scenery tests (4/4).
- First new E2E run: three PC appearances passed; three portrait appearances
  detected a reel right bound of 397.475px in a 390px viewport. The run was stopped
  at the following landscape case. The grip moved inward without changing the
  tip; a new all-vertex / all-level / four-profile Unit verifies containment.
  Failure screenshots/traces remain in `test-results/p5d1-rod-reel/`.

## 5D-2 handoff boundary

The factory and static pose can be replaced without changing equipment state.
This PR adds no takeback/forward animation, dynamic tip/bending, handle/spool
rotation, drag audio, physical line attachment, cast judgement or physics change.
The real-tip world-coordinate line connection remains entirely for 5D-2. Any
future resource allowance must be independently designed and source-verified.

## B resumption: local results and second STOP (2026-11-02)

The B assertion revision and actual Playwright boundary Unit are complete:
41 passes, 42 fails. No other limit, timeout, DPR, retry, skip or CI condition
was revised. No existing-rendering optimization was attempted.

The original 16 new cases were executed: 14 passed, and two purchase cases
correctly rejected a test seed with money but no sold ledger. The new fixture
now funds the initial save through the real register/sell APIs using legitimate
1kg fish. Five additional Unit tests verify ledger totals, wallets and restore.
The same two native purchase cases then passed, including all levels 2–10 with
stable GPU geometry/material identities. The failed seed traces are retained in
`test-results/p5d1-rod-reel-resume/`.

The added first-cast shader helper initially assumed one ring shader cache key.
Actual Three.js transparent DoubleSide rendering has two preexisting BackSide /
FrontSide keys. Its corrected check requires exactly those two distinct existing
keys, one lure key and one line key; the exact new-global-key delta remains one
with READY shader reuse, or two for the historical cold-lure path. Missing,
duplicate, extra and previously unseen ring keys are rejected. Its 8 Unit tests
and the preserved raw cold/LURE evidence pass. The real cold-allocation browser
case then passed without changing its assertions or game source.

A static foreground-order review found that gear and lure both used order 1;
Three's material-ID sorting could let gear overwrite the lure where projected
triangles cross. Gear now uses order 0.5, after the world and before the existing
order-1 lure guides. No lure, line, camera or physics source changed. A new native
portrait rightward 18m-cast case proves actual projected triangle intersections
and the draw-order contract; it passes and saves a screenshot. This makes 17 new
browser cases. The original 16 were validated in separate batches, not relabeled
as one all-green run. The latest order change was checked by focused Unit and
this new browser case; the full 17-case run at that final source is not claimed.

The 15-case related run had 11 passes, three 120-second timeouts and the shader
helper failure above. Trace inspection found normal state/input progression,
with most wall time in frame advances and observation calls. Unit ran concurrently
during part of that first run, which was a plausible load amplifier, not a proven
sole cause. An unchanged isolated run, with no concurrent Unit/browser work,
passed lure reuse and cold resources but still timed out in the following two
existing cases. Initial timeout traces were not discarded.

| Existing case | Approved main, isolated | Implementation, isolated |
| --- | --- | --- |
| Night sailing / FPS / cast, mouse 1000×700 | 120s timeout; reported total 126.017s | 120s timeout; reported total 125.980s |
| Touch real sales / READY-sailing purchases / read-only active fishing | PASS, 112.640s | 120s timeout; reported total 120.914s |

Reported totals include fixture/diagnostic time. These single-run wall times are
not a GPU benchmark. The main comparison used a separately Git-archived and built
`936210d2d118e4e66e2e4426a198d626f84742e8`, the same tests and Chromium, and the
same viewport/DPR/input/clock/timeout/worker/retry settings. Only the reference
baseURL/server lifecycle differed. A new-function cost contribution to the touch
case cannot be excluded; the evidence does not establish an environment-only cause.

Measured implementation for the timeout comparison was the pre-order-fix product
tree `0e953036640037015a65e75f4d9e9f7543d1507a`. The subsequent order-only fix has
product tree `6d1f829fa250ea3d58b54908ea8fbe13c7216408`, browser-checked at
`5fa0defe3d7c4fa127dfd80f5ade38798f7bc8f1`. Geometry, material and draw counts did
not change; the timeout cases have not been claimed to pass at that later source.

Local reports:

- New cases: `/tmp/barb-p5d1-rod-reel-resume.json`,
  `/tmp/barb-p5d1-isolated-e2e.json`, `/tmp/barb-p5d1-foreground-order.json`.
- Related cases: `/tmp/barb-p5d1-related-e2e.json`; initial timeout diagnosis:
  `/tmp/barb-p5d1-timeout-diagnosis.json`.
- Exact-main probe: `/tmp/barb-p5d1-baseline-timeout-probe.json` and
  `test-results/p5d1-baseline-timeout-probe/` including reference build log.
- Representative preview and original-image hashes are preserved locally under
  `/tmp/barb-p5d1-review-evidence/`; their pre-order-fix source provenance remains
  explicit. Raw images/traces were not added wholesale to Git.

PR submission is stopped because the required local success is not established.
Do not solve these failures by extending timeouts, reducing quality, adding retry
or skipping checks. A PM decision is needed on another execution environment or
an explicit local-completion exception that delegates the two unresolved cases
to unchanged L2 CI. No such exception is assumed. No PR, push, CI run, merge or
deployment was initiated. Final full-L2 coverage, real validation-merge parents,
34 real Mobile pairs / 68 images, `ci-required`, real devices and frame-time
p50/p95 remain unverified. The earlier 339-ID collection-only audit predates the
additional overlap case; the resulting inventory needs re-audit before submission.


## Final audit and conditional L2 handoff (2026-11-02)

The STOP records above are historical. After reviewing the bounded 5D-1R
investigation, the user PM explicitly authorized one independent 5D-1 PR with
both local timeouts still unresolved. This changes the final verification
location to GitHub Actions L2; it does not declare the failures successful,
prove absence of a product performance problem, or authorize merge/deployment.
The two known 120-second cases are not to be repeated in this local environment.

Final submission G0 preserved `codex/p5d1-rod-reel`, saved HEAD
`5fa0defe3d7c4fa127dfd80f5ade38798f7bc8f1`, and approved remote/main and
origin/main `936210d2d118e4e66e2e4426a198d626f84742e8`. Open PR count was zero.
The 81 previously uncommitted lines above were backed up and retained verbatim;
their original document Git blob was `e0c281634762e01965556728488eff7c48ef24f6`.
Existing evidence hashes were checked before editing. No reset, clean, forced
checkout, branch replacement or new worktree was used.

The final audit found no additional production dependency or essential defect.
The only product files in the complete PR remain `src/main.js`,
`src/rendering/rod-reel-model.js`, and `src/rendering/rod-reel-view.js`.
The product tree remains `6d1f829fa250ea3d58b54908ea8fbe13c7216408`.
Model ownership, all 20 structural identities, canonical equipment reads,
atomic integer boundaries, unchanged line/camera/input/save/audio sources,
and the source-verified Mobile transition retain the impact matrix above.
The <=41 rotated-FIGHT contract remains specific to this PR and accepts no
42-call result. Design headroom is not an automatic allowance for 5D-2.

[The 5D-1R evidence summary](PHASE5D1R_DIAGNOSTICS.md) records all four measured
main/current-product runs, CPU constraints, SwiftShader, observer overhead,
resource/input equivalence and the limits of causal attribution. Its old main
success and old-implementation failures remain distinct from current results.
Raw local traces/images are retained outside Git; no bulk generated assets,
secret documents or private configuration are included in this PR.

The recovery collection was 340 IDs: Regular A104, Regular B178, Mobile58;
all original 339 IDs were retained, plus the foreground-order case. The new
17 cases belong to B. Original versus independent three-lane collection had
no missing, extra or duplicate IDs. Final submission collection, exact execution
commit, fresh Unit/Build and selected-browser outcomes are recorded in the PR
body; collection does not stand for execution success.

The final browser selection is the new 17-case rod/reel spec plus the existing
PC/touch smoke tests. It does not include the two known timeout cases. New
appearance evidence retains normal saves/native controls at PC1280x800,
portrait390x844, landscape844x390 and small360x740 profiles, without changing
any existing DPR, timeout, worker, retry or assertion. Appearance screenshots
are Playwright attachments in Regular B's `test-results/` artifact; the
existing Mobile artifact must still provide the real34 pairs /68 images.
The PR body separately identifies fresh evidence, older evidence and items
not executed. No historical failure record is removed.

**Merge prerequisites:** GitHub L2 Unit/Build; exact340-ID execution with all
Regular A/B and Mobile cases passing; real34-pair/68-image source comparison;
real SHA/provenance and two-parent validation merge; the same build artifact;
no skip/retry/flaky/expected-fail; final `ci-required` success; and PM/user
real-device acceptance. Workflow, aggregator, CLI signatures and quality
contracts are unchanged. Codex submits the PR URL and stops without waiting
for CI, merging, deploying or starting 5D-2. CI failures return to this same
chat only after a separate PM log review and repair instruction.
