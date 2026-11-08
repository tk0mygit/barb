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

Local measurements and limitations are recorded with the implementation PR. Full
Regular A/B, Mobile 34-pair comparison, ci-required and physical-device acceptance
remain separate gates. No Actions monitoring, merge or Pages deployment is performed
by this implementation task.
