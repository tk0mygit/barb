# Phase 5D-2: cast motion and physical tip attachment

## G0 and implementation boundary

User PM approved base main `f2e87f9fd5262b99bb42af1fe835d7bd13307ade`.
The initial audit stopped because the approval SHA was absent and origin/main
was stale (`0a336ef674d6d5f637f7c35ffcd467fadbe3625a`). No implementation
occurred before the explicit restart. On restart, `work` was clean at the
approved SHA. Actual remote main matched before and after `fetch --no-tags
origin`; origin/main and the new `codex/p5d2-cast-motion` HEAD matched too.
Existing `work` and `feat/barb-initial-game` branches were preserved. No reset,
clean, forced update, branch deletion or additional worktree was used.

This same 5D-2 chat implements one independent PR. The runtime's existing
Codex setting is retained. Authorization ends on reporting the PR URL and HEAD;
no CI polling, merge, deployment or later Phase is included.

## Preimplementation impact matrix

| Layer | Direct change | Indirect observations / invariant |
| --- | --- | --- |
| Game state / clocks | None; read phase/time/revision | Cast validity, 8/32/40m targets, flightSeconds=0.8, integration and pause contracts remain exact |
| Input / QTE | None | Native pointer/touch, preparation, cancel/blur/hidden/pagehide, FIGHT delivery and receipt/presentation clocks |
| Camera / rendering | Main display ordering; equipment transforms | Existing camera parent, position/quaternion, FOV/clip and 0.1s preparation interpolation unchanged; resize synchronous render included |
| Model / line / lure | Existing assembly rotates; actual local tip copied to reused line buffer | Same-frame world attachment; lure endpoint, curve and judgement unchanged; no new mesh/geometry/material/texture |
| HUD / save / sales / audio | None | Existing occlusion bounds, click targets, V1/V2, canonical equipment, purchases and subscriptions/disposal |
| Unit / browser E2E | Focused motion, attachment and native phase evidence | Strict neutral 58%/57% retained; animated AIM/CAST use independently transformed actual model tip; Float32 error bound derived numerically |
| Mobile capture / comparator | Narrow exact-source display transition and source replay | 34 pairs/68 images; static AIM/CAST replay revised only for animated source; actual SHA/build provenance, camera/HUD/buffer/DPR and exact resources retained |
| Source equality / 5D-1 resource introduction | Main/fishing byte-reversal proof; view replay | No absent-to-present resource allowance for this model-to-model PR; model blob and all other product/build inputs equal |
| Aggregator / ci-required / CLI | No planned API or workflow change | Capture -> writeMobileComparison -> compareMobileCapturesWithSources, then independent ci-summary replay; awaited rejection still reaches CLI exit 1 |

Intentional differences are AIM takeback/hold, CAST forward/recovery, a short
READY return following an interrupted AIM/CAST, and the line's actual world
origin. Neutral READY/LURE/BITE/FIGHT/LANDING projection, actual resource
counts, the camera, water target, lure endpoint, flight timing, input, QTE,
HUD, saves and audio are invariants. Hidden gear/line must not expose stale tips.

## Comparison design fixed before implementation

The Mobile matrix captures inactive/READY/BITE/FIGHT states, not AIM/CAST;
therefore it needs no image exception for the intentional animated poses.
The existing static source replay currently checks AIM/CAST as neutral and must
instead replay both actual source versions using their respective APIs while
retaining strict neutral assertions. The new-source replay must check dynamic
poses, actual localToWorld versus the out-vector API, unchanged camera and
resource identities, including repeated/time-skipped updates.

A separate 5D-2 display proof is pinned to the approved base SHA and an exact
product allowlist: main.js, rendering/fishing.js, rendering/rod-reel-view.js.
The reviewed main update-order and fishing line-origin edits must reverse
byte-for-byte to base source. The model, other product paths, build inputs,
domain/input/camera/HUD remain exact. Both SHA sources are loaded independently.
Only after this proof may rotated-FIGHT's fishingViewBlob equality be replaced
by the verified display transition. Its camera/HUD/resolution equality and
independent camera/fight replay remain. Fixed and actual resources stay exact;
no new resource allowance exists. Capture, report, aggregator and CLI share the
same awaited validation function, with negative/provenance tests.

If this bounded design cannot satisfy existing gates without widening budgets,
thresholds or other acceptance conditions, implementation/PR submission stops.
Rotated-FIGHT remains <=41 calls; the 5F-1 reservation stays untouched.

## Validation ledger

The implementation rotates the existing root around model-local grip
`[0, .12, 0]`, using the camera's +X pitch axis. AIM smoothsteps to +14 degrees
over .18s and holds; CAST reaches -8 degrees at .12s and returns to neutral at
.50s. Ordinary cancellation returns to neutral over .22s. Phase-entry angles
are sampled at inferred `elapsed - state.time` boundaries, rather than copied
from the last rendered angle. A first standalone CAST seek seeds the held
takeback; a missed revision or hidden lifecycle clears previous history.
READY-only interruption hooks clear canceled motion on menu/blur/hidden/pagehide;
a paused active CAST retains its phase clock and pose. The .1s preparation
camera, domain clocks and flight start remain unchanged.

`update(active, state, elapsed)` applies the camera and rigid model transform.
`copyTipWorld(out)` uses the current root's `userData.tip` and `localToWorld`;
it returns null when hidden/disposed. Main calls both before fishingView.update,
including the second display update after a visibility recall. Fishing copies
the supplied origin into the existing Float32Array; the lure end is unchanged.
The view owns the existing collection subscription and idempotent disposal.

Product changes are limited to main.js, rendering/rod-reel-view.js and
rendering/fishing.js. Comparison changes are compare-mobile-performance.mjs
and lib/mobile-rod-reel-replay.js. Unit changes cover fishing-view,
rod-reel-view and mobile-rod-reel-comparison. Browser changes are the new
cast-motion.spec.js and minimal assertion/observer extensions in
rod-reel-fixture.js and cast-visibility.spec.js. No workflow, selection,
aggregator, CLI signature, Mobile capture spec or acceptance threshold changes.

The static test contract changes only during AIM/CAST: neutral phases retain
the existing strict 58%/57% assertions; animated line tests instead require
exact Float32 encoding of the same-frame actual tip, and independently replay
source transforms. The new three native browser cases cover PC/Lv10/8m,
portrait/Lv1/32m/rightward and landscape/Lv5/40m/leftward, with menu cancellation,
active-CAST pause, native pointercancel/recast and rotation. Existing portrait
FIGHT/QTE and smoke cases are selected separately. Their executions are never
inferred from collection alone.

`npm ci --cache /tmp/barb-p5d2-npm-cache` passed with no lockfile change. Before
full Unit execution, the unchanged scenery test's required historical commit
`eb10aa13ec302a7a4c9b4a421a596f447c8f6e7c` was absent and was fetched exactly.
Initial focused checks passed 12 motion, 8 fishing-view and 13 comparison
cases before the additional lifecycle regression case. The first broader
focused attempt rejected uncommitted runtime source and encountered sandbox
child-Node `EPERM` in an existing CLI test. These are recorded failures, not
passes; final full checks run against committed source with subprocess access.

The first committed source (`6b6aff38d5e20c88cdda43abde0970a2a2bf14d7`)
passed all 1,027 Unit cases, Build, the three new motion cases and the three
selected existing FIGHT/QTE/smoke cases. Subsequent screenshot review found
the original 18-degree takeback crossed the landscape top HUD by about 6px.
This visual defect was not caught by the original viewport-only assertion.
The angle was reduced to 14 degrees; every-level Unit vertex bounds and native
browser checks now require clearance from the top HUD. The browser requirement
uses the actual DOM rectangles and retains a 2 CSS pixel margin. Existing
projection, attachment, resource, timeout and quality assertions are unchanged.
The original screenshots/results are retained separately from final verification.

Final Unit/Build/local browser execution and collection outcomes, exact execution
SHA, numerical evidence and attachment paths are recorded in the PR description,
separately from GitHub L2, actual Mobile comparison and real devices.
The two known 120-second local night/equipment cases are delegated to unchanged
L2 and will not be repeated here. No old 5D-1 local failure waiver is generalized
to a newly failing 5D-2 case.

Additional rendering cost is zero calls/triangles/geometries/materials/textures;
two model geometries and one shared material remain owned by the existing view.
The 5F-1 reserve remains +2 calls/+1,500 triangles. Headless Chromium uses
SwiftShader here; no software-renderer wall time is represented as real-device
GPU FPS or acceptance. Real-device frame-time p50/p95 remains unmeasured.
