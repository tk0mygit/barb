# Phase 6-A implementation contract

Base: `4a9255054565310f857e74dc52f77c0b885c762b`. This change adds the eight approved species in encyclopedia positions 13–20. Validation level: L2.

| Boundary | Direct changes | Indirect observations / required verification |
| --- | --- | --- |
| Species / encounter state | Eight definitions, complete weights, tiers and affinities | 24 conditions × rod Lv.1/5/10; old pairwise ratios; length/weight endpoints; RNG order |
| Fight / clock / input | No physics, timing or input changes | New resistance profiles finish normally with QTE 0–3; existing input and timing tests |
| Camera / world / renderer | No implementation changes | New fish selection can change FIGHT trajectory and camera; comparison fixtures must replay their intended species |
| HUD / DOM / images | Eight immutable PNGs; registry supplies 20 slots | Catch / grid / detail / storage; PC and touch rotation; unknown metadata absent; deferred loading |
| Sales / history | Uncommon base floor 50 before QTE bonus | Unsold quotations change; historical sold amounts, times, wallet and lifetime totals remain authoritative |
| Save / achievements | V3 + roster revision 1 + achievement contract 3; original twelve award set | Strict source-version validation before construction/migration; all dates preserved; conflict/quota/future guards |
| Artwork capture / reports | Twenty images, separate provenance and alpha profiles | Chromium decode, margin, dense near-opaque body, soft edges, exact build hashes, no extra PNGs/archives |
| E2E capture / comparison | Extend species/save fixtures; mobile capture records constant RNG .01; all cold-source replays and the shared gate check this input | Both 12/20-species builds choose the same black bass/size; historical .5 evidence remains supported. Keep original capture IDs, image quality, resources and source provenance checks; no camera exception |
| CI gate / CLI / workflow | Existing L2 classification and lanes retained | Unit/Build → Regular A + Regular B + Mobile → ci-required; collection and execution remain distinct |

## Save and staged achievement design

Keep `barb.save.v1.slotA/B` and storage envelope version 1. A V3 game envelope requires `rosterRevision: 1` (the twenty-species roster) and achievement `contractVersion: 3`. V1/V2 may contain only the original twelve IDs and their original achievement contracts (unversioned or 2). Validate the entire source schema, then construct all domains before exposing restored state. Only V1 receives QTE count zero. Historical sold records and unlock timestamps are not repriced or regenerated.

Load never writes. The next normal save writes V3 to the inactive slot, preserving the selected old original. No key is deleted. Existing raw checkpoint, duplicate-generation, corrupt-slot backup, quota, constructor failure and other-tab protections remain. Actual pre-V3 code must reject V3 and protect both slots even with a readable old backup. This permits a protected read-only rollback; it does not promise older builds can play new species or write older progress.

Future Phase 6-B (28 species) and 6-C (36 species) must increment `rosterRevision` to 2 and 3, validate the exact older roster before migrating, and retain its source contract. Any unsupported roster revision or achievement contract protects both slots, even when the other slot is readable. Simultaneous localStorage check/write is not atomic across tabs; the existing documented race remains.

The stable `normal-species-12` ID now measures capture of every member of the explicit original-twelve set; `normal-species-5` counts distinct species. No 24/36 target is displayed in 6-A. Introduce the 24 target with contract 4 in 6-B and the 36 target with contract 5 in 6-C, when those targets become reachable. Each later migration must retain existing unlock dates and evaluate newly introduced awards at the current migration/event time, never invent a historical unlock time. This follows the existing unversioned → contract 2 policy for newly introduced equipment awards.

## Artwork

The original twelve PNGs retain their original bytes and checks. The additional eight are AI-generated illustrations with morphology reviewed and PNGs approved by the project PM; copied byte-for-byte without processing. [Approved IDs, scientific names and SHA-256](artwork/phase6/approved-6a.json) identify this subset. Automated format/alpha/decode checks do not establish anatomical correctness. Distribution remains subject to the applicable generation service terms and project license review. Source ZIPs, generation prompts and private review documents are not published here.

The twenty PNGs total 11,012,560 bytes. The full Phase 6 artwork review threshold is 20 MiB; 6-A also requires the exact approved total and per-image 800 KiB maximum. Near-opaque alpha (≥250) is accepted for the new immutable images only, with a dense body, soft edge and eight transparent margin pixels; the original twelve retain their opaque-pixel assertions.
