# Phase 5D-2R: upright cast preparation

## Authorization and G0

The user PM approved main `11d7f85e0f61d176f196bc8df89a3c7bf7c0bc03`
after PR #58 merged, and explicitly requested this independent correction in
the current conversation. The current Codex runtime setting is retained.
Scope ends on submission of one PR; no CI waiting, merge or deployment.

Initial checkout `codex/p5d2-cast-motion` was clean at
`678b772910e78adc2fef337ab08871108e94a905`; origin/main was stale at
`f2e87f9fd5262b99bb42af1fe835d7bd13307ade`. Actual remote main matched the
approval. Non-destructive fetch updated origin/main, then a new
`codex/p5d2r-upright-cast` branch was created from the approved SHA. Re-G0
confirmed remote main/origin/main/HEAD equality and a clean working tree.
Open PR count was zero. Existing branches and all earlier evidence remain;
no reset, clean, branch deletion/forced update or additional worktree.

## Preimplementation impact matrix

| Layer | Direct change | Indirect observations / invariant |
| --- | --- | --- |
| Game state / clock | None | Cast validity, distance/landing point, .8s flight, accepted time and pause contracts |
| Input / QTE | None | Native PC/touch, cancel/recast, menu lifecycle; overlapped buttons remain operable |
| Camera / rendering | Rod/reel root's local display pose only | Camera pose/parent/FOV/clips, .1s preparation and main display order unchanged |
| Model / line / lure | Upright rigid transform and small camera-local grip depth offset | Existing actual-tip API, same-frame line origin, unchanged lure trajectory/endpoint and resources |
| HUD / dialogs / saves / sales / audio | None | PM permits rod visual overlap only; reel clearance, DOM hit targets, V1/V2, equipment and ownership retained |
| Unit / browser | Angle/pose and rod-only HUD assertions updated | Exact actual vertical axis, all-level viewport bounds, 30/60/144/sparse frames, native rotation/low-FPS/cancel and Float32 attachment |
| Mobile raw capture / source comparator | No planned change | Existing READY/BITE/FIGHT captures are neutral; all 34 pairs/68 images, exact resources/camera/HUD/DPR retained |
| ci-required / CLI / workflow | None | Shared source replay still validates each actual SHA; existing awaited final-gate/CLI failure propagation unchanged |

Intentional changes are the AIM/early-CAST rod pose and its permitted visual
overlap with upper dialogs. All neutral phases, physical state, camera, input,
DOM layout/hit areas and resource counts are invariants. The obsolete rod-only
2px exclusion is replaced by positive upright-axis and button-hit verification;
the reel's 2px exclusion and whole-assembly view-volume checks remain strict.

## Pose and comparison design

The sampled takeback target represents a 90-degree upright pose. The actual
rotation is calculated from the neutral shaft direction to the camera's +Y
axis, including its small horizontal lean. This places the real shaft upright
in both portrait and landscape. It preserves the model-local grip pivot
`[0,.12,0]` and the current model scale. A camera-local depth offset of up to
0.20m, quadratic in the positive lift fraction, keeps the tip inside the view
without stretching the rod. It vanishes continuously at neutral/forward poses.

Existing AIM .18s, CAST forward .12s/recovery .50s and cancellation .22s timing,
revision anchors, reset hooks and actual localToWorld tip copying are retained.
The rod and reel remain the same two meshes/geometries sharing one material.
There are no per-frame geometry/material/texture allocations or extra draws.

Only rod-reel-view.js changes in production; main.js, fishing.js, model factory,
camera and all game/input/UI/build sources stay byte-identical to the approval.
Both Mobile transition allowances are inapplicable to this model-to-model view
adjustment. Existing source replay accepts animated poses while enforcing exact
neutral projection, endpoints, hidden lifecycle, camera and resource identity.
Actual base-to-HEAD replay and unchanged-source checks will be recorded before
PR creation. No new image/resource exception or comparator weakening is planned.

## Verification record

Final execution SHA, Unit/Build, selected native browser outcomes, image/JSON
evidence and collection IDs will be recorded in the PR. Local full E2E, actual
Mobile 34-pair/68-image comparison, GitHub L2/final ci-required, real validation
merge/artifact hashes and real devices are delegated and remain distinct from
local success. Known 120s night/equipment cases are not repeated locally.
