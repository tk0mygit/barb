# Phase 6-B implementation contract

Base: `4edd6c191ff9fd7d4cc8e93908d781106b72071a`. Scope: approved ordinary fish 21–28, one main-targeted L2 PR. No merge or deployment. Phase 6-C and final device/Pages acceptance require separate PM gates.

| Boundary | Direct changes | Indirect observations / required verification |
| --- | --- | --- |
| Species / encounter state | Eight appended definitions; complete weights, tiers and all affinities | 4 lures × 3 depths × day/night × rod Lv.1/5/10 = 72 conditions; positive normalized probabilities; original twelve pairwise ratios; old twenty coefficients and images unchanged; RNG order |
| Fight / clock / input | No implementation changes | New resistance profiles, length endpoints, QTE 0–3 and normal landing; species fixtures select production interval midpoints |
| Camera / world / renderer | No implementation changes | New selection can alter fight trajectory and camera; cold-source replay and capture RNG must retain the intended fish and input history |
| HUD / DOM / images | Eight immutable PNGs; registry supplies 28 slots | Catch, grid, detail, storage, PC/touch rotation and scrolling; unknown names/descriptions/individual PNG URLs absent; deferred images |
| Sales / history | No pricing algorithm changes; eight new unit prices | Rounded weight → half-up base with Uncommon floor 50 → noncompound QTE bonus; bulk/individual agreement; historical sold amounts, wallet and dates preserved |
| Save / achievements | Writer V3 revision2 / contract4; append normal-species-24 | Validate V1/V2 original12 and original contracts, V3 revision1 twenty / contract3, V3 revision2 twenty-eight / contract4 before migration; preserve prior records and timestamps; reject cross-revision IDs |
| Storage / rollback | Existing two keys and storageVersion1 unchanged | Load writes zero; next save writes one inactive slot; future revisions/contracts/versions protect both; actual revision1 client rejects revision2; quota, conflict, duplicate generations and constructor failure retain originals |
| Artwork capture / reports | Approved 6-B public ledger and 28-image totals | Exact SHA/bytes, RGBA8/sRGB/noninterlace, dense near-opaque body, soft contour, clear 8px margin, Chromium decode, build contains exactly 28 PNGs / 15,788,012 bytes |
| E2E capture / comparator | Extend roster/revision expectations and minimal affected fixtures | Keep source provenance, capture IDs, image/HUD/resource checks and final gate; no fabricated state, tension or QTE results to mask failures |
| CI gate / CLI / workflow | Existing L2 classifier and lanes retained | Unit/Build → Regular A + Regular B + Mobile → ci-required; full collection/execution ID agreement; local tests are not CI success; PM audits CI after PR creation |

## Save source contracts

Wire validation and migration are separate. V1/V2 accept only the original twelve species and their unversioned/contract2 achievements; only V1 gains QTE count zero after complete validation. V3 revision1 accepts only the explicit first twenty IDs and contract3's fifteen awards. V3 revision2 accepts the first twenty-eight IDs and contract4's sixteen awards. A saveVersion3 discriminator alone never bypasses revision migration. Unknown future revision or achievement contract is unsupported before traversal of future fields, protecting both slots even with a readable backup.

Existing catches, dispositions, QTE counts, sold amounts/times, wallet, equipment, boat, clock and award timestamps remain authoritative. The new 24-species award counts distinct captures, independent of storage or sale, and receives only its actual evaluation time. The original-twelve award still requires every original ID. No 36-species award is introduced. Load never writes; the next legal save preserves the active source record and writes the other slot once. Existing localStorage simultaneous-tab race remains documented in SAVE_DATA.md.

## Artwork

Only the approved eight images are copied byte-for-byte. [Public image ledger](artwork/phase6/approved-6b.json) records IDs, scientific names, bytes and SHA-256, without source ZIPs or private review data. Added PNGs total 4,775,452 bytes; all twenty-eight total 15,788,012 bytes. Original twenty retain their exact source bytes. The original twelve's stricter opaque-pixel tests remain; approved later additions retain dense near-opaque body, soft contour and transparent-margin checks. Automated checks do not establish anatomical correctness. Final PC/Android device and public Pages acceptance remain PM gates.

## Local validation

Implementation SHA: `f213a64a0bc4c25ae22157553faab9e5db380560`. The subsequent submission commit changes only this validation record and an E2E title. Product source and build inputs remain identical.

| Check | Observed result |
| --- | --- |
| Install | `npm ci --cache /tmp/barb-npm-cache` passed; lockfile/dependencies unchanged |
| Full Unit | `npm test`: 1,141 passed, zero failed/cancelled/skipped |
| Build | `npm run build` passed; existing large Three.js chunk warning |
| Artwork | 28/28 source PNGs structurally valid and Chromium-decoded; SHA/bytes exact in dist; 15,788,012 PNG bytes; 18,507,855 build asset bytes; no extra PNG/ZIP |
| PC/touch production | Phase 6-B grid/detail/rotation/scrolling, eight source-matching images, unknown metadata/URL concealment, sales and save/reload: 2 passed |
| Common smoke | PC + touch: 2 passed |
| Related E2E | No production PNG preload, sixteen-award live UI including 24 species, native cancellation/QTE/line-break/retry: 3 passed |
| Local execution integrity | Seven collected IDs exactly equal seven executed IDs; each passed once with retry zero |
| L2 selection | Existing classifier selects all 40 browser specs; no workflow/classifier/gate modifications |

The first full Unit run had fourteen failures: stale roster/award/cell-count expectations, the old final-species expectation, a fixture's image substitution count, a new fish outside the historical pacing profile, a missing historical source commit, and the deliberately strict uncommitted-source provenance guard. Updated the roster expectations, fetched only the missing referenced commit and committed product source before the passing full run. Historical twenty-species 16s/20s equivalent-span pacing limits remain intact; the eight approved new profiles retain the same all-lure/size/30–144fps capture checks with the existing 30s elapsed limit (observed new-species maximum 25.70s). No production physics or approved numbers were changed. A newly added RNG test initially assumed a boolean return from `cast`; it now verifies the actual CAST transition and exact three consumed draws. The first default-cache install failed to write npm's log/cache path; the same lockfile install succeeded using the temporary cache.

Unexecuted locally: full WebGL suite, all 28 consecutive production browser captures, and the 34-pair Mobile comparison. Unit exercises of the comparison/final-gate code are not actual CI evidence. Required Actions lanes are Unit/Build, Regular A, Regular B, Mobile and `ci-required`; their real run IDs, collected/executed IDs and validation merge SHA must be audited by PM. Codex does not monitor/wait for CI after creating the PR. No direct main push, merge, deployment, real-device acceptance or Phase 6-R completion was performed.

## Regular B: bounded all-species production coverage

Run `42387501237`, Regular B job `128448248315`, timed out after 600,000 ms in the single 28-species fishing test. Its PR HEAD was `1b9e0335c80b81a9cbe3e2c30c4998b2fca833ee`; its validation merge was `0929b835a8154d9f0cbd437daa8cf474e9f6c4ef`. The later closed-page error was secondary to the timeout. The log does not establish an image/species mismatch or the detailed cause of runtime variability.

The replacement is one serial suite: four seven-species production segments (No.1–7, 8–14, 15–21, 22–28), each with a 300,000 ms budget, then a separate final collection/save-reload test with the existing default timeout. Every cast, hook, fight, native QTE, landing, exact result-image byte comparison and return to READY remains. Each segment also prepares/cancels another native cast at its boundary. The final test retains the ordered 28 discovered entries, 28 stored fish, unique IDs, scrolling, and exact captured QTE counts across reload.

Each test uses Playwright's normal context/page, trace and diagnostics lifecycle. No context is shared in `beforeAll`. Only the previous successful segment's browser-produced `storageState()` and observed virtual wall time cross the boundary; the two save-slot strings are transferred without parsing/re-encoding or editing. Before more fishing, both original strings and the entire caught-species/QTE prefix are checked. Each boundary flushes the normal pagehide autosave and checks stored dispositions, unique IDs and the complete prefix before publishing the next checkpoint. No catch or fishing state is fabricated.

Playwright serial scheduling blocks dependent tests after failure; no explicit skip/fixme/only or success fallback is introduced. The unchanged CI gate rejects failed or unexecuted parts. One concise completion record per fish and an always-attached segment summary record species IDs, completed count, current stage and real elapsed milliseconds. Context, listener and trace cleanup stays with the existing diagnostics fixture. Other suites receive no checkpoint.

The long five-part production run is left to formal L2 CI; local collection and a short storage/fixture lifecycle probe do not establish its actual runtime or success. PM must audit all five executed IDs and the final 28-catch checks. Old fixed-count searches and time-budget review remain proposals for a later operating-rule change; this fix does not amend those rules, product code, images, save schema or workflows.
