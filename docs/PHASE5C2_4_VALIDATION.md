# Phase 5C-2-4 implementation and acceptance evidence

The 5C-2-4 OFF evidence below is historical. The separately authorized
5C-2-ON-1 enablement and its own evidence are recorded at the end of this file.

Baseline: `32cc64e20875693267239bbf5b4f3448c37855c3` (PR #53).
This is the dedicated 5C-2-4 chat/branch. The implementation brief recommends
Max-level consideration. Scope ends at local validation and one PR; product
QTE remains OFF. Merge, deployment, device acceptance and later phases require
separate instructions.

## Change impact matrix (before implementation)

| Path | Direct work | Indirect observation / required evidence |
| --- | --- | --- |
| game / encounter / RNG | Shared gameplay factory; per-fight QTE factory boundary | Same encounter draws, fish, length, ordinary fixed-tick physics with OFF; deterministic provider makes no gameplay RNG calls |
| fightId / provider | Create once from actual new fight identity, reuse immutable descriptors | Distinct next-fight identity; no operation repeats within 1–3 reservations |
| delivery / active clock | Compose existing clock, evaluator and delivery; bounded diagnostics, retirement | A/D inclusive, C exclusive, 100ms / 128 edges unchanged; seal once, no stale fight ingress |
| canvas / pointer | Pass delivery to the existing fishing input and controls | Native PC / Chromium touch, BITE / cast / hold / menu ownership; old release quarantine |
| pause / resize | Existing reason-set hooks; one geometry owner; explicit technical recovery | Menu + blur / hidden / page, orientation re-presentation, minor resize cannot reset deadlines |
| rAF / physics / barrier | Poll before fixed physics; prepare HUD before render and present after a later opportunity | No unresolved-time catch-up; actual WebGL rendering; post-QTE normal hold and camera tracking |
| HUD / DOM | ON-only QTE HUD; lifecycle cleanup; visible restart instruction | No QTE DOM/handlers/timers in OFF; free scoring area on small screens, canvas is sole pointer owner |
| LANDING / catch | Existing confirmed success count path unchanged | Single immutable count; no capture on abort/loss, no duplicate effects |
| sale / wallet / achievements | No price/schema changes | Existing +10% noncompounding, 0–3 successes, immediate / individual / bulk, preserved historical amounts and dates |
| V1 / V2 / storage / autosave | Inject same gameplay factory before load/subscription | Read-only load, old active raw retained, invalid/future/conflict/quota protection, READY restore, same two slots |
| screenshots / comparison | Preserve all current capture IDs and comparisons | OFF ordinary state/camera/resources unchanged; 34 pairs / 68 images remain L2 CI requirements; ON evidence names its source and native inputs |
| CI / collection / CLI | No selection, workflow, comparison or aggregation changes planned | L2 full Regular + Mobile, exact collected/executed IDs, source/parents/hash evidence and final ci-required remain distinct gates |

The test-only ON entry is supplied by Playwright routing over the actual
`src/main.js` initializer and its real dependency graph. It must not recreate
the application loop, bypass hook/landing, or be emitted into `dist`.

Local results, source identity, remaining gaps and device template are recorded
below as validation completes. Unmeasured device data must say **unmeasured**.

## Implemented composition

- `main.js` has one nonexported `startGame()` initializer. Its shipping call has
  no arguments and its QTE default is false. No URL/hash/storage/global/UI ON
  option or fixture HTML is emitted to the distribution.
- `gameplayFactory` is supplied before `createSaveStorage.load()` and used for
  both new and validated V1/V2 domains. Restored fishing is never replaced;
  achievements are constructed last, before UI/autosave subscriptions. Valid
  candidate constructor errors, including `SaveDataError`, become
  `restore-failed`; main stops rather than assembling an empty replacement.
  Corrupt/future/backup/read-only cases keep the existing storage protections.
- Fishing obtains a fresh provider from the actual hook's new fight identity
  before controller construction. The selector, scorer and HUD reuse that
  provider's immutable descriptors. Provider selection consumes no fishing RNG.
- Native controls stamp receipt before focus/capture and pass delivery to the
  existing fishing input. Technical restart uses that same stamped entrance;
  its contact cannot score. OFF adds no QTE clock, HUD, pointer handler or timer,
  and does not take the optional per-frame QTE snapshot.
- The previous successful render is required before the later HUD presentation
  opportunity. Controls poll/cut precedes fixed FIGHT physics. A resolving frame
  admits only its post-cut portion, capped by existing dt; unresolved QTE time
  is not banked. Input and FIGHT use the same admitted duration. Ordinary
  post-cut source times map monotonically into that capped physics tail;
  scoring source/receipt times and A/D/C are unchanged. A normal contact is
  claimed only after existing controls admit its down, so an ignored secondary
  or hybrid pointer cannot replace it. Matching cancel before sealing and
  canvas blur also clear queued normal input. HUD geometry is prepared before
  the actual WebGL render.
  Display/orientation/technical recovery keeps rendering available; external
  pause reasons still stop the normal application loop. Physical screen emission
  is not claimed by a browser presentation callback.
- Main owns geometry invalidation once. Minor resize cannot reset A/D/C; idle
  rotation cannot suspend a future fight. Retirement clears old transport state
  and internal reasons on defeat/landing/abort, retaining external reasons.
  Context loss disposes the opt-in HUD and existing audio/autosave components.

The price function, canonical count, V1/V2 schemas, storage keys/versions,
physics constants, encounter tables, dependencies, workflows, comparison
thresholds, capture IDs and final CI conditions were not changed.

## Independent ON evidence and unchanged OFF comparison

`qte-production-fixture.js` routes the actual source graph and installed Three.js
(including its real WebGL renderer), replaces the final initializer call, and
loads the unchanged stylesheet via a link. The test does not reconstruct the
loop or force FIGHT/LANDING/catch state. Cast, BITE, hook and reeling use native
canvas inputs. Test RNG is explicitly injected and checked for the original
three encounter draws; no product RNG setting is introduced.

Before routing, the fixture rejects a dirty runtime tree and records Git HEAD,
`HEAD:src` and main SHA-256. A separate bounded capture-phase observer records
native source/receipt times, coordinates, identity and coalesced samples. Normal
operation audits reject truncated or untrusted evidence. The explicit synthetic
coalesced negative is identified separately and is not native/device proof.

`qte-production-audit.js` archives the exact recorded commit into a temporary
Node module graph. It checks the source identities, independently regenerates
provider/difficulty, reconstructs contacts from the separate native observer,
re-scores A/D/C, and applies that source's QTE effect to the warning snapshot.
Its distance/tension and counts must exactly match the emitted resolved event.
Each audit records its input hash, operation/direction, identity and actual SHA.
These are state/effect checks; no image/camera comparison is exempted.

All existing 34 comparison IDs / 68 images remain required by L2 CI. Local paired
captures are reported as selected pairs only. Unit fixtures for source replay,
missing/forged SHA, hashes, missing IDs/images, failed/cancelled execution and
CLI exit propagation remain separate from actual GitHub CI results.

## Local environment and evidence ledger

Commands use the locked dependencies (no package/lockfile changes), Node
24.19.0, Playwright 1.64.1 and installed Chromium 154.0.8037.57. Browser runs use
`taskset --cpu-list 0,1` on the observed CPUs 0–2 with a two-CPU cgroup quota.
The existing tests' DPR settings and SwiftShader are preserved. CI's designated
Chromium 156 is unchanged and is a separate run. No real device was used.

Artifacts below live in ignored `test-results/phase5c2-4/`; generated files and
credentials are not committed. Retain the failures alongside later results.
The old PR #52 PC-through / PR #53 touch-four-catch local timeouts were not
rerun as those exact scenarios; no general resolution of those failures or
old G0 is claimed. They are not exemptions for a new failing case here.

| Attempt | Result / cause / treatment |
| --- | --- |
| `npm ci --cache /tmp/barb-npm-cache` | PASS; dependencies unchanged |
| `unit-initial.log` | FAIL: 54/62 test files passed in sandbox; synchronous git/Node children reported EPERM, and historical scenery SHA `eb10aa13ec302a7a4c9b4a421a596f447c8f6e7c` was absent. Direct `save-v2-diagnostic.log` / `ci-e2e-diagnostic.log` reproduce EPERM. Fetched that exact historical object without changing main/working branches; unchanged tests ran outside sandbox |
| `unit-unsandboxed.log` | PASS 961/961 at `341801ac28af88de19a6e7c9a87713a80a9d9f03`, 45.3s; this does not establish the cause of any old G0 failure |
| `production-tap-initial/` | FAIL, 120s: test-only import map omitted `three/addons/objects/Sky.js`; raw index favicon placeholder also produced 404. Trace/diagnostics preserved; routed the installed addon and resolved the HTML placeholder |
| `production-tap-routing-fix/` | FAIL, 120s: stopped test clock did not render the fishing-mode HUD before clicking hidden cast. Trace identifies `#cast-button`. Added the corresponding real loop frame |
| `production-tap-frame-fix/` | FAIL, 120s: three QTEs, landing and RESULT passed, then test waited on the still-disabled menu immediately after result close. Added the normal HUD-update frame; no production duration/assertion/retry change |
| `production-representatives.log` | PASS 2/2 at `1a89c5d`: PC new tap/3-success/bulk and touch V2/swipe/2-success/immediate, both returning to shipped OFF; 1.3min |
| `unit-render-gate.log` | PASS 961/961 at `1a89c5d` runtime, 43.9s |
| `production-matrix/`, `production-run.json` | At `acc7eaada9674fccca9cca6679851e1d44acc23b`: 17 PASS / 1 FAIL, skip0, 750.3s. All eight operation/media paths and 24 independent audits passed; OFF six paths, lifecycle, interruption and all-failure paths passed. Real-clock tap failed: A=18275/D=20275/C=20375 in E; first down E=21383 (raw21398, clock offset15), already 1108ms after D. Large observations/mouse setup after A delayed the test's first input; highWater0 and no console errors. Preserve the original trace rather than calling late input successful |
| `production-tail/`, `production-tail-run.json` | PASS 4/4 at `37a8eb2`, 2.8min: enhanced lifecycle, 128edge/coalesced/right-button negatives, all-failure cold-source audits, corrected real-clock 3tap. Pointer/full observation/CDP setup moved into warning time; six native press/release commands and small pending observation kept the real 2s/100ms and assertions intact |
| `unit-protected-restore.log` | PASS 961/961 at `37a8eb2`, 43.6s; standard and typed constructor errors both protect raw and stop retry |
| `delivery-ingress-targeted.log` | PASS 53/53: technical restart uses first receipt, cannot score, deduplicates overflow event, preserves checkpoint/deadline |
| `unit-final-source.log` | PASS **962/962**, fail/cancel/skip0, 44.8s at `cf110d9` runtime (same runtime tree as `6668d9b`) |
| `build-final-source.log` | PASS at `cf110d9` runtime; existing Three.js 500KB chunk warning only |
| `production-final/`, `production-final-run.json` | PASS 20/20, skip0, 13.3min at `6668d9b`; this predates the post-cut admission correction below and is historical evidence, not the final runtime result |
| `normal-handoff-diagnostic.mjs`, `frame-admission-red.log` | Reproduced a normal release becoming a later ghost hold: cut1700, down3600, frame3700, up3810, ghost after5610. Three regression failures established that input origin and admitted physics time differed on a capped frame |
| `frame-admission-green.log`, `frame-admission-green-v2.log` | Initial correction passed two regressions; a new release assertion sampled before the existing fixed tick. The final test crosses that tick explicitly and all three cases pass; no fixed rate or hold threshold changed |
| `frame-cancel-red.log`, `frame-cancel-green.log` | Before/after sealing cancel and canvas-blur regressions: 3 PASS / 3 FAIL before correction, 6 PASS after |
| `frame-secondary-red.log`, `secondary-release-red.log` | Independent negative regressions reproduced ignored-secondary owner replacement and a non-left mouse completion. Actual down admission now claims the normal owner; a non-left completion cannot score |
| `frame-secondary-green.log`, `secondary-release-green.log` | PASS 7/7 frame-admission and 54/54 delivery tests after correction |
| `unit-admission.log` | PASS **970/970**, fail/cancel/skip0, 43.7s at runtime `9f127e8` |
| `build-admission.log` | PASS at `9f127e8`; existing Three.js 500KB chunk warning only |
| `handoff-native/`, `handoff-native-run.json` | FAIL 1/2, second not run (fail-fast): expected first resumed admission0.25s, observed0.35s. The test-only Three devtools observer was never initialized, so the callback had not been held. No page/console errors. Initialize its EventTarget and require observed skipped callbacks before sending post-cut input; retain the strict0.25s assertion |
| `handoff-native-fixed/`, `handoff-native-fixed-run.json` | PASS 2/2, skip0, 57.1s at `a7a599c`: actual main callbacks are held and then resumed over a long monotonic gap. Native mouse release and touch cancel-before-seal both retain the strict0.25s admission, independent source audit and no-ghost assertions |
| `production-accepted/`, `production-accepted-run.json` | **PASS 22/22**, fail/skip/flaky/retry0, 832.1s at `a7a599cc84019bccc83730988834ffa715933701`. Four operations × two media, OFF six new/V1/V2 paths, lifecycle/128edge/all-failure/real-clock, 1/2 reservations and two long-frame handoffs. **32 independent exact-source audits** passed. `production-accepted-evidence.json` confirms collected/executed IDs and source/tree/main hashes |
| `smoke-accepted/`, `smoke-accepted-run.json` | **PASS 2/2**, fail/skip/flaky/retry0, 61.3s at `a7a599c`: real built shipping entry, native PC sailing/fishing view and touch sail/end/cancel/menu. `smoke-accepted-evidence.json` confirms the two collected/executed IDs |
| `regression-accepted/`, `regression-accepted-run.json` | **PASS 14/14**, fail/skip/flaky/retry0, 149.4s at `a7a599c`: shared clock/audio/lifecycle; legacy PC/touch autosave; FIGHT reload; corrupt/backup/future/quota/denied storage/conflict/renderer failure; mobile layout/rotation; QTE layout/menu checkpoint. `regression-accepted-evidence.json` confirms exact selected/collected/executed IDs |
| `mobile-selected/`, `mobile-selected-run.json`, `mobile-selected-pairs/` | **PASS 4/4 tests**, fail/skip/flaky/retry0, 172.1s: actual baseline `32cc64e2` and tested head `a7a599c`, unchanged DPR2 / native inputs / source-camera replay / strict resources-buffer-HUD comparator. Four pairs / eight images: `portrait-day-tps`, `portrait-bite`, `portrait-fight`, `rotated-fight`. `mobile-selected-evidence.json` verifies IDs, SHAs and image count. `comparison-incomplete.json` explicitly retains **full 34-pair comparison unexecuted** |

`distribution-check.json` confirms no private routed fixture or diagnostic
globals in `dist`; the shipping initializer remains argument-free/default OFF.
A baseline-to-HEAD diff also leaves package/lock, workflows, scripts/comparators,
price/canonical validation, fixed FIGHT/QTE constants and existing controls
unchanged. These static checks do not replace the actual ON/OFF executions.

Final runtime source tree: `2483f99681a4ae13a843ec0531e2681093ebd069`
(runtime commit `9f127e89f0fa1d785ebcb8330d1150ffc28c827c`). Final test and
documentation commits share that exact runtime tree. Source-stamped browser
results identify their own tested HEAD; GitHub validation SHA / merge parents
are not yet generated. Final local totals are **970 unit tests + build +
42 browser tests**, with all local collected/executed IDs matched, one attempt
per final case and no skip/retry. The 42 include the four selected capture
tests; this is not all L2 E2E.

## Selection, collection and remaining CI gate

`final-name-status.z` contains the actual baseline-to-HEAD NUL-delimited diff.
The unchanged classifier selected **L2**, all **32 specs**, both smoke specs,
and `deploy:false`; shared initialization/input/restore and the new operational
documents cannot be treated as L0/L1. `final-l2-plan.json` records the full list.

`accepted-pr-style-collection.json` is a **local collection only**, with the
actual base/head SHAs in a clearly named simulated PR event. The unchanged
`validateCollection`/`splitSpecs` checks found **313 tests**: Regular **31 specs /
255 tests**, Mobile **1 spec / 58 tests**, including both base/PR captures and
the final 22 production cases. `accepted-collection-summary.json` records their
identities. This does not create a GitHub validation merge or certify CI.

The local scope is production composition, two shipping-entry smokes, selected
storage/audio/layout/lifecycle regressions and selected real base/PR capture
pairs. It is not the complete 313-test L2 execution. Before merge, 8th_PM must
check the latest PR HEAD, current main, validation merge parents, all selected
and collected/executed Regular/Mobile IDs, all **34 pairs / 68 images**, signed
source/hash evidence and final **`ci-required`**. These GitHub results are
**unconfirmed** at submission. No CI completion wait or polling is performed.

Submission preflight on 2026-10-31 again ran `git fetch origin main` and read
the remote branch/PR metadata: main still exactly matched the baseline, the
dedicated remote branch was absent and there were zero open PRs. Read-only
GitHub APIs reported main `protected:false` and Rulesets `[]`; no settings were
changed. `submission-preflight.json` records those observations. PM protection
setup/check steps remain in [TESTING_WORKFLOW](TESTING_WORKFLOW.md#mainの最新性とブランチ保護):
Settings → Branches / Rulesets → main → required `ci-required` and up-to-date
branches. Do not assume the settings enforce the manual review gates.

## Device acceptance and enablement

[The device form](QTE_DEVICE_ACCEPTANCE.md) leaves every PC / Android Chrome /
iOS Safari measurement **unmeasured**. The 100ms receipt grace and 128 semantic
edges remain provisional; software/emulated results do not settle their product
appropriateness, reject rate, physical visibility or real device capacity.

Product enablement requires explicit user-PM authorization, all device gates
and current full L2 results, followed by a separate initializer-enablement PR
and L2 run. This implementation does not publish an ON route or perform that
change. Current scope ends at one PR URL, with no CI polling, merge, deployment
or later phase work.

## Phase 5C-2-ON-1: public enablement (2026-10-31)

User-PM explicitly authorized QTE ON and a single enablement PR, based exactly
on main `dae7faa0585343e751eb63e6eebe648f7101fe42` (PR #54). This is the new
enablement chat, not Phase 5D. The brief recommends Max-level consideration.
The initial clean `work` checkout at PR #53 is retained; the dedicated branch
starts at the fetched, matching main. Open PRs at entry: zero. No worktree,
reset, clean, force push, merge or deployment is authorized or performed.

### Enablement change impact matrix (before implementation)

| Path | Direct change | Indirect observation / required evidence |
| --- | --- | --- |
| Public entry | Explicit `startGame({ qteEnabled: true })` | Unmodified built Pages entry must run ON; no URL/storage/global switch |
| New / V1 / V2 gameplay | None; retain shared factory and default OFF injection boundary | Both validated restores and new games inherit public ON; never replace restored fishing |
| Provider / encounters / RNG | None | Actual hook creates existing provider; operations and encounter draws unchanged |
| Canvas / delivery / clock / HUD | None | Native mouse/touch, four operations, warning/display/finite seal, lifecycle/cancel/rotation, normal fresh hold |
| Physics / camera / rendering / audio | None | Existing FIGHT settings and input ownership; shipping smoke and shared audio/lifecycle regressions |
| Catch / price / achievements | None | Confirmed count0–3, additive +10% per success, immediate/individual/bulk, no duplicate settlement or historical recalculation |
| Save / restore | None | V2 writer and two keys; V1 raw preservation, V2 revisit, corrupt/future/conflict/quota fail-closed; previous main can read ON-written saves |
| ON/OFF tests / acceptance docs | Update public expectations; retain explicit OFF and fail-closed initializer matching; add built-entry evidence | Injected source evidence is identified separately from actual distribution execution; devices remain unmeasured |
| Capture / comparison | None planned | Selected real base/head pairs; retain all 34 pairs / 68 images, strict resources/HUD/source replay |
| CI aggregation / CLI / workflows | None | L2 full Regular/Mobile selection and collection, source/merge parents/artifact hashes, separate `ci-required` review by 8th_PM |

The 100ms grace, 128 semantic edges, all operation thresholds/windows/cuts,
warning0.6s, reservations/failure effects, sale arithmetic and storage contracts
remain unchanged. Real device ON acceptance and product suitability of the
provisional values remain unmeasured; see [the acceptance record](QTE_DEVICE_ACCEPTANCE.md).

### Enablement implementation and local evidence

The only executable product delta is the final initializer argument. A static
baseline comparison removes comments and proves every other executable byte of
`main.js` unchanged; every other `src` file, package/lock, workflow, comparator,
CI aggregator and Playwright configuration is unchanged. New/restore factory
defaults remain OFF, and the private routed fixture explicitly injects either
boolean after matching the actual public ON initializer, failing closed on a
different expression. The earlier OFF-only labels/revisit assertions are updated.

`qte-public-on.spec.js` uses the ordinary built `/barb/` document, without routing,
source replacement or a returned gameplay handle. It hashes the served HTML and
entry JS against `dist`, records source/tree/main/build hashes and observes UI,
trusted canvas input and saved records. Clock/RNG/save fixtures are test-only.
Mouse/touch cases cover all four initial operations, three finite resolutions,
counts0/1/2/3, shortest non-tap window, landing, immediate/individual/bulk sale,
V1/V2 history/raw protection and a new ON fight after ordinary V2 revisit.
The existing source-injected tests remain separate evidence, with their cold
exact-source audits and explicit OFF paths retained.

Older catch/transaction fixtures held their local `held` flag across a QTE,
although the product correctly cancels that contact. `expirePublicQte` sends
the native release, observes an actual finite failure and requires the HUD to
hide within the existing warning/window/grace/result duration; then the caller
must send a fresh normal down. Normal-physics iteration budgets and all result,
price, save and resource assertions remain intact. It cannot accept success,
interruption or unavailable layout. The autosave checkpoint helper now pairs
synthetic pagehide/pageshow when continuing the same session; leaving `page`
suspended without a return is intentional production behavior.

The twelve-species capture/image driver instead follows each displayed mouse
gesture and requires its finite success, catch bonus count and V2-restored count.
This keeps its original100-step normal budget and600s Playwright timeout while
covering approved ON play. Deliberate all-failure paths remain covered separately;
they are not forced into that old OFF capture budget.

This task uses Node24.19.0, Playwright1.64.1, installed Chromium154.0.8037.57,
SwiftShader and the existing DPR settings, with `taskset --cpu-list 0,1` on a
two-CPU quota. CI's designated browser remains unchanged. Local commands that
need child-process/loopback access run with that environment access; a default
sandbox static audit reported `spawnSync git EPERM` before rerunning successfully.
No product or CI change was made for the environment.

Evidence is under ignored `test-results/qte-public-on/`, not committed artifacts.
Failures are retained independently from subsequent passes:

| Attempt | Result / cause / treatment |
| --- | --- |
| `npm-ci.log` | PASS, locked dependencies; no dependency/lockfile change |
| `unit-initial.log` | PASS970/970, fail/cancel/skip0, 42.8s; runtime at `34730b6` |
| `build.log` | PASS at the same runtime; existing Three.js500KB chunk warning only |
| `public-pilot/`, `public-pilot-run.json` | FAIL2/2 at `34730b6`: cast entered the real state machine but the new DOM-only test read AIM before rendering its next frame. Added one normal250ms frame; no product/timeout/assertion change |
| `public-pilot-v2/`, `public-pilot-v2-evidence.json` | PASS2/2 at `e432b53`, skip/flaky/retry0, 120.8s: ordinary build mouse tap count3/bulk and touch V2/swipe count2/immediate, both reaching a fresh ON fight after V2 revisit; HTML/JS hashes and exact collected/executed IDs match |
| `legacy-initial/`, `legacy-initial-run.json` | FAIL2 (PC/touch first landing), then intentional diagnostic stop:1 interrupted and9 unstarted. Native history shows the pre-QTE down at13.3s was not refreshed through46.05s. Corrected the test's old-hold assumption; failures and unexecuted cases remain recorded |
| `legacy-pilot/`, `legacy-pilot-run.json` | FAIL2/2 at `bb0f2f5`: first captures passed with three observed finite failures; second captures remained paused because the synthetic save checkpoint sent pagehide without pageshow. Corrected the continuing-session event pair; no product lifecycle relaxation |
| `legacy-pilot-v2/`, `legacy-pilot-v2-evidence.json` | PASS2/2 at `296181f`, skip/flaky/retry0, 187.0s: native PC/touch captures, RESULT rescue, sales, purchases, sailing, repeated reload and a second capture; exact collected/executed IDs match |
| `rollback-pilot.log` | Diagnostic script failed before execution: default archive buffer included unnecessary artwork and exceeded1MiB (`ENOBUFS`). Restricted archive to actual game/world modules, without changing the source or test assertions |
| `rollback-pilot-v2.log`, `rollback-compatibility.json` | PASS6 records: actual preceding-main reader/writer, ON-generated count2/3 caught/sold data plus fixed legacy V1 A/B. Read-only load, original raw, history/wallet/awards and one inactive V2 write retained. Final count0–3 matrix recorded with the full public run |
| `legacy-final/`, `legacy-final-run.json` | At `482a5f2`:4 PASS (PC/touch line continuity and real sale/upgrade/read-only),1 timeout,6 unstarted after explicit fail-fast. `final-stability` hit its unchanged120s limit at the ordinary second sailing/braking `settle()` after all3 catches/saves and both repeated resource plateau checks had passed. No page/console errors or context losses were observed; allocations plateaued at26 geometries/4 textures/13 programs. Lifecycle/reload tail is **incomplete**, not PASS. No timeout/DPR/retry/assertion change or same-source rerun; remaining6 cases run separately |
| `legacy-tail/`, `legacy-tail-run.json` | At `482a5f2`:4 PASS (PC/touch three sale routes and ordinary cancellation/missed hook/retry/flick/catch),1 FAIL,1 unstarted after fail-fast. Twelve-species case failed at380.8s with FIGHT/9.0m remaining after its100 normal steps and22 observed QTE failures across preceding fish; no browser errors. Its original OFF capture driver was applying approved ON failure penalties. Replaced this case's gestures with actual displayed QTE successes and strengthened count persistence assertions; retained100 steps,600s, all12 images/catches and collection checks |
| `species-layout/`, `species-layout-evidence.json` | PASS2/2 at `b001a96`, skip/flaky/retry0, 420.6s. All12 actual species captures/images/storage/reload passed in374.1s, including25 UI-driven finite QTE successes and exact V2 count-array restoration; mobile safe insets/short landscape/font/menu/FIGHT/RESULT rotation passed in45.0s. Original100-step/600s bounds and all resource/layout assertions retained |
| `source-selected/`, `source-selected-evidence.json`, `source-audits-summary.json` | PASS14/14 at `b001a96`, skip/flaky/retry0, 515.4s. Explicit OFF6 new/V1/V2 mouse/touch paths return to public ON; actual-source lifecycle/rotation/cancel/reason union,128edge interruption/recovery, three failures/count0, real-clock3tap,1/2 reservations, and native mouse/touch late-rAF handoff/no ghost hold passed. All8 independent exact-source scoring/effect audits passed. This routed source evidence is distinct from the unmodified public build |
| `public-final/`, `public-final-evidence.json` | **PASS10/10** at `b001a96`, skip/flaky/retry0, 624.5s. Unmodified public-build mouse/touch flick/swipe/3tap/target and all-failure cases cover new/V1/V2,30 finite resolutions, confirmed count0–3, immediate/individual/bulk, first V2 save's active-raw protection, historical wallet/prices/award dates, and10 fresh ON fights after V2 revisit. All10 served HTML/entry-JS hash proofs match `dist`; no private initializer/global/route is used |
| `rollback-final.log`, `rollback-compatibility.json` | **PASS22 records**, actual previous main `dae7faa` reader/writer:20 caught/sold records generated by the public ON build plus2 fixed legacy V1 A/B. Counts0/1/2/3, historical amounts/wallet/award timestamps, read-only load, READY rescue, original active raw and one inactive V2 write all pass; the current reader also validates the preceding writer's output |
| `regression-selected/`, `regression-selected-evidence.json` | PASS15/15 at `b001a96`, skip/flaky/retry0, 172.6s: shared clock/audio/lifecycle; PC/touch fixed legacy A/B purchases/autosave/reload; FIGHT reload; corrupt/backup/future/quota/denied/conflict/renderer-init protection; QTE safe-inset/short-landscape/layout failure/rotation and menu checkpoint; actual public-build PC/touch sailing/end/cancel/menu smoke. Exact collected/executed IDs match |
| `mobile-selected/`, `mobile-selected-evidence.json`, `mobile-selected-pairs/` | PASS4/4 tests, skip/flaky/retry0, 163.9s. Real base `dae7faa` and code/test head `b001a96`, unchanged DPR2, source-camera replay and strict buffer/resources/HUD comparisons pass for4 pairs/8 images: `portrait-day-tps`, `portrait-bite`, `portrait-fight`, `rotated-fight`. `comparison-incomplete.json` explicitly records the other30 pairs as unexecuted; full34-pair CI is still required |

The final local union is **55 successful browser cases and1 unresolved120s
timeout** (`final-stability`, later lifecycle/reload portion incomplete), plus
**970 unit tests and build PASS**. `final-local-summary.json` correlates all
collected/executed IDs and retains each earlier failure, interruption and
unstarted case. The unchanged execution validator correctly rejects the failed
whole batches; their4+4 successful cases are reported individually, never as
successful whole runs. All successful completed selected batches have exactly
one execution per case and no skip/flaky/retry. No timeout or comparison rule
was relaxed and no same-source retry was used to claim a fix.

The final code/test commit is `b001a962dcf868a333bde96c67ef96b1ac3ff9a8`.
Documentation-only submission commits retain source tree
`2a1a907e602167e7129d124d0d482b6aff149309` and tests tree
`50c2d8a726999e0bbc14ca114ccc0d0d6b38257f`. `runtime-build-audit.json`
records every distribution asset hash. Main SHA256 is
`f035160c3da92fcb7e288f7808ec7eb8f9c88482e6d359529294c9a0ed465349`;
the public entry `assets/index-doLohu4I.js` SHA256 is
`49d2d3bb1b13d6d868628087b8b1e66d7ec62da669c14d73f30f3dce0bccc3ac`.

Actual NUL-delimited base/head classification selects **L2**, all **33 specs**,
both smokes and `deploy:false`. `final-pr-collection.json` is a **local PR-style
collection only**: the unchanged `validateCollection`/`splitSpecs` check all
**323 cases**, Regular **32 specs/265**, Mobile **1 spec/58**. Source/head/base,
exact IDs and report hashes are retained locally; this is not a GitHub virtual
merge or a successful full E2E execution.

8th_PM must separately confirm current PR HEAD/current main, actual GitHub
validation merge SHA and both parents, Unit/Build, all Regular/Mobile execution
IDs, all **34 pairs/68 images**, artifact/source hashes and `ci-required`.
GitHub full L2 is **unconfirmed** at submission. Codex does not poll CI, merge,
deploy, sign off devices or start another phase. The acceptance form preserves
the explicit ON authorization and the still-unmeasured PC/Android/iOS gates;
its rollback procedure uses a new revert PR and the verified preceding V2 writer.

The older Phase5C-2-4 failures, earlier G0 and prior local timeouts above remain
historical records; this task does not claim to resolve them or use them as
exemptions for new failures. Local execution is selected regression evidence,
not all L2 E2E and not GitHub `ci-required` success. Device measurements remain
**unmeasured**. Full current-head L2 and final release remain 8th_PM/user-PM gates.
