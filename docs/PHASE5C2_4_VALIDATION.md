# Phase 5C-2-4 implementation and acceptance evidence

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
