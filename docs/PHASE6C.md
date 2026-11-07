# Phase 6-C implementation contract

Base: `e221d695045bdf318bc7729faea442e66a34f3a8`. Scope: approved ordinary fish 29–36, one main-targeted L2 PR in the current dedicated Codex chat. Keep the current model/reasoning configuration. PM alone handles merge, Pages and device acceptance; Phase 6-R remains a separate gate.

G0: actual remote/main and local HEAD matched the full base SHA; clean `work` checkout, no untracked work, one existing worktree, zero open PRs and PR #71 merged/closed. Safe fetch updated the stale origin/main; the existing branches remain intact. Dedicated branch: `codex/p6c-add-final-eight-species`.

| Boundary | Direct changes | Indirect observations / required verification |
| --- | --- | --- |
| Species / encounter state | Append eight approved records and complete weight, Tier, lure/depth/time tables | 72 conditions, positive normalized probabilities, old 28 coefficients and pairwise odds, RNG budget/species/length order |
| Fight / clock / input adapters | No implementation changes | Six Rare profiles, three QTEs, initial/Lv.5/Lv.10 equipment, success/failure, tension, reversal and elapsed time |
| Camera / world / renderer | No implementation changes | Selection can alter fight trajectory/camera; production probability interval fixtures and cold-source capture replay must retain intended species and input history |
| HUD / DOM / images | Eight byte-identical PNGs; registry supplies 36 slots | Unknown names/descriptions/URLs absent; result/grid/detail/storage, PC/touch/rotation/scroll, visible queue/LRU and exact Request/DOM cancellation identity |
| Sales / history | Eight approved unit prices; existing algorithm | Uncommon floor 50 before noncompound QTE bonus, Rare standard rounding, individual/bulk agreement; sold history/wallet/timestamps unchanged |
| Save / achievements | V3 roster revision3 / contract5, append normal-species-36 | Fully validate V1/V2 original12, revision1 twenty/contract3, revision2 twenty-eight/contract4, revision3 thirty-six/contract5 before migration; preserve all historical data/dates |
| Storage / rollback | Existing two keys/storageVersion1 and write path unchanged | Load zero writes; one inactive-slot write; future/corrupt/conflict/quota/constructor protections; actual revision2 client rejects revision3 |
| Artwork QA | Public minimal ledger; exact approved near-opaque reference counts | Three specific sub-150k approvals require exact byte SHA/count plus independent pixel/alpha structure; original12 opaque and other density checks retained; 36 build hashes, no extra PNG/ZIP |
| E2E capture / comparator | Update current expectations; append two four-fish production segments and final36 check | Preserve first four checkpointed segments, actual catches/native QTE/trace, complete ID/QTE prefix, source provenance, strict image/HUD/resource comparisons |
| CI aggregate / CLI / workflow | Existing L2 classifier, Regular A/B/Mobile and ci-required retained | Unit/Build then all three lanes; exact collected/executed IDs, 34 Mobile pairs/68 images and validation merge parents; local/synthetic checks never imply CI success |

Source ZIP SHA, all-member CRC, traversal/absolute-path/symlink/duplicate/member-type checks passed. Only the eight required original PNG byte streams are published; archives and private material stay outside Git. Old 28 records, all PNG hashes and all encounter/rod coefficients are frozen in `tests/fixtures/phase6b-baseline.json` from the stated base before implementation.

## Approved additions

| No. | ID / name | Tier / weight | Lure / depth / time | cm | Reference cm / kg | Resistance B / S / A / F | Value/kg |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 29 | red-bellied-piranha / レッドベリーピラニア | Uncommon / 3.5 | worm / shallow / night | 12–38 | 25 / 0.55 | 0.95 / 135 / 0.19 / 4 | 120 |
| 30 | barramundi / バラマンディ | Uncommon / 3 | minnow / shallow / night | 40–160 | 80 / 6 | 1.25 / 200 / 0.27 / 2.8 | 30 |
| 31 | muskellunge / マスキー | Rare / 1.5 | spinnerbait / mid / day | 50–150 | 90 / 5 | 1.37 / 200 / 0.28 / 2.5 | 100 |
| 32 | peacock-bass / ピーコックバス | Rare / 1.4 | minnow / shallow / day | 25–70 | 45 / 1.5 | 1.33 / 160 / 0.30 / 3.4 | 190 |
| 33 | northern-snakehead / カムルチー | Rare / 1.5 | spinnerbait / shallow / night | 35–100 | 60 / 2 | 1.32 / 175 / 0.20 / 1.8 | 135 |
| 34 | lake-sturgeon / レイクスタージョン | Rare / 1 | worm / deep / night | 70–220 | 130 / 14 | 1.48 / 280 / 0.18 / 1.25 | 35 |
| 35 | arapaima / ピラルク | Rare / 0.8 | minnow / shallow / night | 100–240 | 180 / 44 | 1.50 / 300 / 0.24 / 1.4 | 40 |
| 36 | payara / パヤーラ | Rare / 1.2 | minnow / mid / night | 35–110 | 70 / 4 | 1.38 / 165 / 0.32 / 3.6 | 150 |

Every new fish explicitly supplies four lure affinities (preferred 1.60, other 0.85), three depths (preferred 1.40, other 0.90) and two times (preferred 1.25, other 0.90). Sampling remains budget → species → length, three draws; length is uniform then rounded to 0.1cm, cubic weight to 0.01kg. Uncommon alone receives the base floor 50 before the existing BigInt half-up/noncompound QTE bonus. Historical sales are authoritative. No physics, input, timing, rod economics or BITE frequency changed. Arapaima's approved maximum weight is 104.30kg; its minimum base encounter weight remains 0.8 without a rescue draw.

## Save source formats and achievements

| Validated source | Fish IDs | Achievement source | Next writer |
| --- | --- | --- | --- |
| V1 | Original12; QTE field forbidden | Unversioned / 2 | V3 revision3 / contract5; only V1 receives QTE count0 |
| V2 | Original12; QTE count required | Unversioned / 2 | V3 revision3 / contract5 |
| V3 revision1 | Exact20 | Contract3 / 15 awards | V3 revision3 / contract5 |
| V3 revision2 | Exact28 | Contract4 / 16 awards | V3 revision3 / contract5 |
| V3 revision3 | Exact36 | Contract5 / 17 awards | Idempotent V3 revision3 / contract5 |

All source fields and earned-award sets validate before migration or construction. Known revision/contract mismatches and malformed discriminators are invalid data; unknown future revision4+, contract6+ or saveVersion4+ protect both slots before unknown fields are traversed. Existing catches/order/IDs/sizes/weights/QTE counts, dispositions, sold prices/times, wallet/totals, equipment, boat, clock, settings and unlock dates remain unchanged. Load writes zero; the next legal save writes the inactive key once and keeps the old active original. Actual revision2 code from the base SHA rejects revision3 and stops all writes even beside a readable old backup. Existing constructor/quota/conflict/duplicate-generation protections remain.

The sole new award is `normal-species-36` (湖の記録), at 36 distinct ordinary species. Original16 IDs and dates remain stable; 24 means any distinct24, 12 means the original12 IDs. Sale/storage never remove discoveries. The 35/36 boundary, no duplicate unlock, current-time timestamp, roundtrip and missing/duplicate/impossible/invalid-date failures are covered.

## Immutable artwork QA

[Public ledger](artwork/phase6/approved-6c.json) records exact source SHA-256/bytes and approved alpha≥250 counts. Additional eight: 3,764,997 bytes. Old28: 15,788,012 bytes. All36: **19,553,009 bytes** (18.65 MiB), above the 18 MiB effort target but below the 20 MiB review threshold and 24 MiB cap. No recompression or image processing.

Piranha (140,782), muskellunge (124,608) and lake sturgeon (119,415) use their approved exact count with the exact byte SHA, transparent8px margin, visible body and bounded soft contour; their density remains ≥92%. Other additions retain the 150,000 core-pixel check. Independent decoding also revealed that approved barramundi has 234,892 near-opaque / 260,562 visible pixels (90.148% core), with 25,670 soft-edge pixels. For this exact ID/SHA only, source-measured exact visible/soft counts preserve its approved contour. Original12 opaque and all old16 density/contour checks, plus the other new7 density/contour checks, remain intact. Wrong SHA, off-by-one approved count, margin contamination and missing contour are negative regressions. Original PNG bytes are never changed to meet QA.

The exact 6-B Request/DOM cancellation audit and its delayed/reversed binding plus same-URL decode/active-abort/active-failure tests remain byte-identical (audit block SHA-256 `a23ba51c939b725c4caea2a0ea304c3141167752e9db027f931640a3d62b3ee1`). No URL-only or blanket ERR_ABORTED exception was introduced.

## Local verification

Product implementation commit: `e79b1a0` (full SHA and source tree recorded in PR). Later test/document commits keep identical product source/build inputs.

| Check | Observed result |
| --- | --- |
| npm ci | PASS, 21 locked packages in 2s using temporary cache; no dependency/lockfile changes |
| npm test | **1,170 PASS**, zero failure/cancel/skip, 114.791s |
| npm run build | PASS, Vite 269ms; existing large Three.js chunk warning |
| Independent source/Chromium/build image audit | 36/36 exact PNG SHA/bytes, RGBA8/sRGB/noninterlace, transparent8px margin, alpha profiles; no extra PNG/ZIP; build assets 22,278,747 bytes |
| PC/touch Phase 6-C UI | 2 PASS: eight exact built images, 36 slots, unknown metadata/URL concealment, detail/rotation/scroll, sales, revision3/contract5 save/reload |
| Common smoke | PC + touch, 2 PASS |
| Images | No startup preload, 1 PASS; six strict native-disposal/network audit cases, 6 PASS; portrait/landscape visible-priority queue/concurrency, 2 PASS |
| Achievements | PC live17 UI and 35/36 boundary, 1 PASS |
| Native Rare | Initial Lv1 arapaima170cm/37.07kg, three actual QTE successes, exact result PNG, storage/reload, 1 PASS; UI virtual-clock fight observation 23.75s, real test 41.972s |
| Short browser execution integrity | **15 collected = 15 executed = 15 PASS**, each once/retry0; total 158.256s |
| PR-equivalent collection only | 41 specs / 390 IDs: Regular332 + Mobile58; all six production segments and final36 collected. This is not CI execution |

Rare domain evaluation: 6 species × min/mid/max × Lv1/5/10 × QTE0/1/2/3 × tap/flick × 30/144fps = **864 conditions**, all landed with exact success/failure counts and normal RESULT/storage. Another **192 conditions** cover all eight additions × four lures × three sizes × two frame rates with initial equipment. These are parameter conditions, not 1,056 separate test cases. The production encounter interval and real input adapter are used; domain QTE submissions are distinct from the native browser evidence.

| Same feedback strategy, start32m | Observed fight range across Rare6/size/QTE/operation/fps |
| --- | --- |
| Lv1 | 16.37–42.20s |
| Lv5 | 12.03–27.58s |
| Lv10 | 8.72–16.52s |

Equipment improved each matched scenario. All-failure QTE cases still landed with controlled tension; separate short-stop reversal/stall/recovery, sustained-slack escape, nonstop line break and retry cases passed. Evaluation bounds are test observations, never a gameplay deadline. These fixed-seed strategies do not establish human feel or every device/seed.

First full Unit: 1,166 reported, 11 failures, no skipped/cancelled tests. Causes: stale contract/future fixture and award-array limit, current probability extrema and two Lv6 absolute Uncommon-share decreases, fixed 3,780/6,300 integration counts, approved arapaima weight above the old generic100kg bound, missing referenced historical SHA, old species-target list and an alpha-error message. Corrected exact expectations/source-specific boundaries, safely fetched only the missing commit, retained historical fixtures and old pacing/precision/assertions; focused57 and then full1,170 passed. Initial sandbox npm/Node/collection child processes failed with proxy/EPERM; authorized commands succeeded outside that sandbox with the same lockfile/source. No failed browser run, retry or timeout occurred.

## Remaining gates

No local full WebGL run, all36 continuous production fishing, 34-pair Mobile comparison, real Android/PC acceptance or Pages acceptance. The first four seven-fish segments retain their 300s budgets; two four-fish segments are appended with the same budget, then an independent final36 check. Exact browser storage/checkpoint strings, QTE prefixes/unique IDs, native input, trace and fail-closed continuity remain. Real segment runtime/margin must be measured by CI; none is claimed locally.

Required formal L2: Unit/Build → Regular A + Regular B + Mobile → ci-required; all actual IDs/results and validation merge parents must match current main/PR HEAD. CI/run IDs are unconfirmed. Local/synthetic tests never imply CI success. The existing localStorage simultaneous-tab check/write race remains. PM performs merge, Pages and limited device confirmation; full36 acceptance and the Phase6 completion declaration belong to Phase6-R. Stop after branch push/PR submission without Actions monitoring, waiting or reruns.
