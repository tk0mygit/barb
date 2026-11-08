# RIPPLE IMPRINT｜水紋の刻印

Phase 6-E adds presentation for the first capture of each of the 36 existing species.
Baseline main: `17111451aeee11fd65ba16f051ec014faad6ec24`. Risk classification: **L2**.

## Change impact (prepared before implementation)

| Boundary | Direct change | Possible observed effect / required validation |
| --- | --- | --- |
| Canonical state, probability, Tier, clock | None | Read committed collection counts and the LANDING → RESULT catch ID; restored counts are already known |
| Input / fishing / QTE | None | Result controls, Esc, focus and touch must work during presentation; capture, sale and next cast remain immediate |
| Camera / WebGL / scene | None | No new GL objects or draws; software-rendered frame timing still needs observation |
| DOM / notifications / images | Result lifecycle hooks, bounded overlay, notification coordination | Three visible seconds before simultaneous awards; existing fish loader, cache, secrecy and geometry retained |
| Audio | Short Rare oscillator on the existing ready session | One quiet voice; no unlock or AudioContext creation; ambient OFF does not mute this effect |
| Save / economy | None | Registration text means in-memory encyclopedia registration; independent save status remains authoritative |
| Achievements | Presentation queue suspension only | Domain order, IDs, dates and deduplication retained; pending awards get the full five seconds; an interrupted current award keeps its remaining time |
| Browser capture / comparison | New focused cases and necessary fixture wiring | Discovery changes only first-capture presentation; retain existing frame comparisons and all Mobile 34 pairs / 68 images |
| CI / CLI / workflows | None | Existing L2 Regular A/B, Mobile and ci-required must inspect all collected IDs; local results do not establish CI success |
| External access / permissions | None | No new runtime requests, assets, libraries, fonts or permissions |

## Existing expectation survey

- `achievements.spec.js` and `achievement-notice.spec.js` assert five-second queues,
  background deadlines, duplicate suppression, opacity-only fades, the 35% viewport
  anchor and a single accessible region moving between dialogs. Ordinary fixture
  registrations outside the production LANDING/RESULT path keep these expectations.
- `fishing.spec.js` checks native capture, immediate sale/storage, the decoded original
  artwork and QTE prices. Its result layout and state expectations remain valid.
- `fish-assets.spec.js`, `fish-image-loading.spec.js` and `collection-menu.spec.js`
  cover generation/cancellation, failed decode, hidden unknown species and restored
  imagery. Discovery never creates another image or changes the loader.
- `save-data.spec.js` expects no restored award notification. Restored discoveries
  likewise produce no presentation or persistent flag.
- `audio.spec.js` observes a shared lazily unlocked session and independent bite audio.
  Rare uses that same session without changing the ambient preference contract.
- Production-path cases must use cast, probability interval selection, hook, fight/QTE,
  landing and result, with no direct insertion of catches or result state.
- The historical 5E-2B hint-removal Unit fixture uses its reviewed merge commit
  `4852ad449359b41ea0cf75c1d2e9b1d782a711bb`, rather than an evolving HEAD.
  It also rejects inheritance by a changed current HUD. The comparison implementation,
  its source-bound exception, all 34 IDs and every negative layout assertion remain intact.

## Presentation contract

Common/Uncommon use a single silver-white ripple and immediate NEW SPECIES / 新種発見.
Rare uses staggered double ripples, RARE DISCOVERY / 希少種発見, fine amber double
imprints and one soft low tone when audio is already ready. Both last exactly three
visible seconds: ripple at 0–0.5s, original-artwork scan at 0.5–1.5s, canonical name,
図鑑登録完了 and canonical No.XX / 36 at 1.5–2.5s, fade at 2.5–3s.
Reduced motion keeps the complete static message for the same duration.

Synchronous achievement awards are buffered until the registration turn completes.
A matching discovery takes priority before the first result paint. Closing the result
cancels its presentation and releases awards without undoing capture or save.
Hidden/blur/pagehide pause the discovery's visible time; return resumes that same
presentation without replaying its sound or announcement. A canceled result never
replays. Existing already-visible achievements preserve their remaining turn during
the discovery; queued simultaneous achievements each start their full five seconds.

## Validation

Validated runtime commit: `e05df37da3d9b6d941ee1e952d987005768c9f38`.
The PR records the final HEAD separately; subsequent changes are tests/documentation.

- `npm ci`: success, 21 existing locked packages installed; no dependency changes.
- `npm test`: **1,179 / 1,179 passed**, no skipped/canceled/todo tests (121.54s in the final run).
- `npm run build`: success, 100 modules; the existing Three.js chunk-size warning remains.
- Local Browser slices covered **59 distinct cases**: 23 discovery cases and 36
  existing notification, image, restore, menu, smoke and audio cases. These were
  selected runs, not the complete browser inventory. The 58-case run had 56 passes
  and two image expectations awaiting adaptation; the corrected image cases passed
  in the next 25-case slice (23 passed). Its two real-time sampling failures were
  fixed without changing their opacity expectations; the affected six cases then
  passed, including all four layouts and both real-time timelines. No retries or
  timeouts were added, and no assertions were removed.
- First-time capture tests use the built application's native cast/draw/hook/fight/QTE/
  landing/result path: black bass (two QTE successes), northern pike (three). Both
  save, reload and render the encyclopedia without replay. UI/Unit fixtures additionally
  cover Common, Uncommon, Rare, No.01/No.36, duplicate IDs, known recaptures, image
  delay/404/decode rejection, hidden-before-start, blur/pagehide recovery, early
  close/sale/Esc, context loss, disposal and achievement queue release.
- Desktop 1000×700 and touch 320×568 / 390×844 / 844×390 were exercised with reduced
  motion, synthetic safe insets and a 20px root font. Result field/button rectangles
  remain unchanged. Real taps/clicks sell a second distinct catch while its discovery
  is still visible. Accessible text is not rewritten on lifecycle recovery.
- Native Chromium audio observed one shared ready AudioContext, zero new oscillators
  for Common and one for Rare with ambient loops OFF. Unit fault cases cover waiting,
  blocked/unsupported/interrupted/closed sessions, partial allocation, one-voice
  suppression, short gain/frequency envelopes and lifecycle teardown.

### Local resource observations

Built production paths used ANGLE / Vulkan SwiftShader, 800×600 CSS pixels, DPR 0.5.
The same renderer counters were observed during discovery, immediately afterward,
and in the subsequent normal result interval:

| Metric | Common | Rare |
| --- | --- | --- |
| Temporary overlay DOM (including root) | 14 → 0 | 16 → 0 |
| Total DOM during / after | 156 / 144 | 158 / 144 |
| Draw calls / triangles per submitted frame | 27 / 275,164, unchanged | 27 / 275,164, unchanged |
| Live geometries / textures / programs | 27 / 4 / 13, unchanged | 27 / 4 / 13, unchanged |
| Additional requests during presentation | 0 | 0 |
| Observed WebGL context losses | 0 | 0 |

The existing achievement region adds its two child nodes after discovery, explaining
the total-DOM differences. No second fish image, scene object or shader is created.

CDP also recorded browser task/layout durations. The staged overlay interval delivered
four main renders per case: Common task 1.325s / layout 6.323ms, Rare task 1.259s /
layout 10.415ms. The following 600ms simulated normal-result interval delivered 38
renders: Common task 11.030s / layout 47.710ms, Rare task 7.947s / layout 13.723ms.
These are **different windows**, include capture/protocol work and ran under software
rendering; they do not establish FPS, equivalent workload, or a numerical animation
overhead bound. Live renderer counters are not GPU-memory bytes or a trace of every
transient GL allocation. Browser recordings validate visible stages, not physical
Android frame pacing.

### Corrections and remaining gates

Initial diagnostics were retained locally. Missing historical Git objects were
fetched, and strict source-provenance checks were run after committing runtime source.
The historical HUD fixture was pinned as described above. New test data was corrected
to derive size awards from the actual individual. Native cast tests present the AIM
preview before releasing. Image tests keep their original pixel/generation assertions
after the new scan completes. Real-time sampling waits for the frame after its target
deadline, retaining the same strict opacity checks. WAAPI presentation is anchored to
the notice's monotonic visible-time deadline, avoiding a pending-play start delay.

Full Regular A/B, Mobile 34 pairs / 68 images, validation-merge parent checks and
`ci-required` are **not verified locally** and remain mandatory L2 gates. Physical
PC/Android acceptance, OS mute behavior, GPU memory and real-device frame pacing are
unverified. No CI/workflow/comparison implementation, probability/Tier, QTE, economy,
save schema, PNG bytes, permissions or secrets were changed. Actions monitoring,
merge and Pages deployment are not performed by this implementation task.
