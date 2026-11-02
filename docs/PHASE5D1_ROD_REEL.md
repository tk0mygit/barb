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
