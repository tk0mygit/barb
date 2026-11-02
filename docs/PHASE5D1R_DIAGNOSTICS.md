# Phase 5D-1R: bounded timeout diagnosis and L2 handoff

## 1. Scope, G0 and preservation

This is a public, bounded evidence summary for the static rod/reel PR, not a
claim that its local E2E failures were resolved. The user PM reviewed these
results and subsequently authorized moving final verification to unchanged
GitHub Actions L2, with both failures prominently unresolved. Merge, deployment
and subsequent feature work are not authorized.

- Branch: `codex/p5d1-rod-reel`.
- Measured product commit: `5fa0defe3d7c4fa127dfd80f5ade38798f7bc8f1`.
- Approved/actual remote main and origin/main:
  `936210d2d118e4e66e2e4426a198d626f84742e8`.
- Measured/current product tree: `6d1f829fa250ea3d58b54908ea8fbe13c7216408`.
  Subsequent submission documentation changes do not change this tree.
- The existing 81-line uncommitted documentation append was preserved, then
  included in this PR. Original document blob:
  `e0c281634762e01965556728488eff7c48ef24f6`.
- Existing evidence51 files remained hash-identical, including10 trace ZIPs
  with valid CRCs. New trace4 files also have valid CRCs. The measurement
  scripts were hash-checked unchanged during execution. No new worktree,
  reset/clean, destructive checkout or remote mutation occurred during 5D-1R.

## 2. Method and unchanged execution conditions

A is `day-night.spec.js`: night sailing/FPS/cast with mouse1000x700.
B is `equipment-game.spec.js`: touch real sales/READY-sailing purchases and
read-only active fishing. The original spec/helper files were imported from
the same current checkout for both implementations, not rewritten.

Both implementations were Git-archived and independently production-built with
the same locked dependencies; both builds passed. Source/build-input blobs
were checked against each exact commit. Each run had a fresh preview server
at the same loopback URL and a fresh browser/profile/context, with no browser
prewarm or OS-cache flushing. The fixed order was A/main, A/current, B/current,
B/main. Exactly4 browser runs were performed, each one attempt; no retry/skip.

| Condition | Actual unchanged value |
| --- | --- |
| Test / expect timeout | 120000ms /15000ms |
| Workers / retry / repeat | 1 /0 /1 |
| A | mouse1000x700, DPR0.5, actual buffer500x350, original real clock |
| B | touch/mobile390x844, context DPR0.5; original spec's window DPR0.25, actual buffer97x211; original paused Clock and advance requests |
| Runtime | Node24.19.0, Playwright1.64.1, Chromium154.0.8037.57 on Debian13 |
| Launch | Original `--enable-unsafe-swiftshader`; default headless conditions preserved |
| CPU / memory | cpu.max200000/100000 (2 CPU quota), affinity3 logical CPUs, memory limit8GiB |
| Actual GL | ANGLE/Vulkan/SwiftShader Device(Subzero); no `/dev/dri` |

Temporary wrappers/config/reporters lived outside the repository. Only
trace retention changed to `on` for diagnostic preservation on success as well
as failure; screenshots=false, snapshots=true, sources=true remained unchanged.
All4 runs timed out, so there is no newly generated success trace. No extra run
was made to obtain one. Initial wrapper `--list` file filtering found0 cases;
correct title filtering collected exactly one per run before any browser run.
That preflight error remains recorded separately.

Measurements include external CLI wall clock, 1Hz/proc CPU and cgroup counters,
2-second CDP process CPU, API reporter steps and original browser traces;
read-only Three devtools render observations, native real-clock submission
times, state/camera/resource counts, trusted input, QTE, errors and warnings.
Init captured native performance.now before the mocked clock. Browser
Performance counters reset on navigation, so B's final-document metrics are
not treated as full-test cumulative CPU. GPU timer extension
`EXT_disjoint_timer_query_webgl2` was unsupported in every document: GPU
completion time is **unmeasured**, and no timer queries were allocated.
`renderer.render()` duration is synchronous submission time; GPU-process CPU
seconds below are also CPU time, not GPU-device time.

No Unit/build/other browser jobs ran concurrently. Monitoring itself used
4-6 CPU seconds per run, about1.6-2.2% of the two-core capacity on average.
Render-observer synchronous totals were approximately33-69ms per run, but
this excludes other CDP/reporting/serialization/scheduling effects. Total
measurement overhead has no uninstrumented control and is **not isolated**.

## 3. Main/current measurements

| Order/case | Result | Playwright total s | CLI total s | Average CPU/quota | GPU-process CPU s | Monitor CPU s |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 01 A night / main | timeout120s | 129.764 | 133.196 | 97.47% | 235.46 | 4.294 |
| 02 A night / current product | timeout120s | 128.331 | 131.325 | 98.39% | 236.47 | 4.409 |
| 03 B touch / current product | timeout120s | 121.837 | 125.692 | 95.22% | 194.96 | 4.098 |
| 04 B touch / main | timeout120s | 132.245 | 135.054 | 95.06% | 202.63 | 5.933 |

The120s test limit was unchanged. Totals include browser/fixture startup,
failure diagnostics, teardown and trace saving; a total above120s does not
mean the test timeout was extended. All4 CLI results were exit1/timedOut,
not successful or expected failures. Full process/Node CPU and API details
remain in the local raw reports; the timeout exceptions were not modified.

A's API-step p50/p95 was main1364/4995ms, current1485/4213ms. READY's
synchronous render p50/p95 was main1.2/4.7ms, current1.2/6.16ms, while render
start gaps were main412.5/672.75ms, current410.7/545.52ms. Different live-clock
camera/moon-drag histories prevent interpreting these differences as a model
performance delta. API sums can overlap and are not a wall-time partition.

B requested exactly383 fastForwards on each side:250ms x272,100ms x102,
3500ms x1,60000ms x1,6000ms x7. Their aggregate API waits were main59.210s,
current61.315s.250ms-call p50/p95 was main202.0/427.1ms versus
current206.5/301.9ms. Paused-menu large virtual advances were short; requests
that rendered and observed state repeatedly waited on the order of200ms.
A Clock request is not necessarily one rendered frame.

Both B runs progressed through two LANDINGs, six QTE completions, purchases,
the planned third FAILED, return to sailing and reload. Six QTE payloads were
exactly equal. Current's first two FIGHTs had275 total rendered frames, matching
main. After clock resume/reload, long waits also occurred in sailing where
gear is hidden; main's enabled check was about6s and a subsequent evaluation
about9.6s. Cancellation/after-hooks can overlap a still-progressing original
callback: error lines and final snapshots are **not** proof that all those
steps completed inside the budget. Reload's complete assertion sequence has
not passed. All4 runs had0 pageerrors,0 console errors,0 context losses.
Shared warnings were the existing PCFSoftShadowMap fallback and GL ReadPixels
stall notices; warnings alone do not locate or prove the cause.

Historical results stay distinct: old main B passed112.640s; the old
implementation timed out120s, reported120.914s. That old implementation
product tree was `0e953036640037015a65e75f4d9e9f7543d1507a`, not the current
measured product tree. Old A timed out on both. Old main success has no trace
because its original retention was failure-only; no lost trace is implied.

## 4. Cause candidates and confidence

- **Observed:** wall-clock budget is consumed while native operations,
  Clock/frame progress and DOM observations continue. Both current and main
  fail in this environment. CPU quota is95-98% utilized, predominantly in
  SwiftShader's GPU process.
- **Strongly supported contributor:** CPU-limited software WebGL/browser
  work. This is not proof that it is the sole root cause or that products on
  real GPUs have no performance issue.
- **Plausible but unseparated:** renderer/compositor/driver queue pressure,
  Playwright actionability/observation waits, scheduling and diagnostic load.
  Low-level task/GPU-service completion tracing was not collected.
- **Not established:** a game/input/QTE permanent stall. State/camera/QTE
  evidence progresses normally; this does not rule out every logic defect.
- **Unknown:** the additional3D drawing's time contribution. Neither a zero
  impact nor an exact latency regression can be inferred from four single
  runs or from total-time differences.

## 5. Resource and state comparison

For B's first document,376 frames correspond by frame index, elapsed mock
clock relative to first render, mode/phase/QTE and camera position/quaternion
rounded6. Initial absolute mock performance.now was main27ms/current19ms.
The absolute-time join found0 matches; that record was retained, and only
this diagnostic join accounted for the observed8ms clock-origin difference.
No test input/time, raw capture, source-SHA comparator or acceptance threshold
was changed. This is not the Mobile34-pair gate.

| Matched state | calls delta | triangles delta | geometry delta | texture delta | program delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| Initial sailing before first gear draw | 0 | 0 | 0 | 0 | 0 |
| Visible rod1/reel1 | +2 | +488 | +2 | 0 | +1 only at initial READY/AIM;0 after CAST |
| Visible rod2/reel1 | +2 | +572 | +2 | 0 | 0 |
| RESULT/FAILED/sailing after use | 0 | 0 | +2 retained | 0 | 0 |

Initial program+1 is early use of the existing shared lure shader. Geometry
count stays+2 across the level change; no other matched resource delta was
observed. Example first FIGHT: main33calls/275436triangles/24geometries/
4textures/12programs; current35/275924/26/4/12. With rod2, current triangles
are276008. This diagnostic did not measure Lv10 or active reel2, nor rerun
the approved41/42 rotated-Mobile boundary. Those scopes remain separately
identified in the implementation record and final PR validation ledger.

## 6. Unresolved verification and risk

Both local cases remain unresolved and are not successful. Per-cell variation,
measurement overhead, driver/compositor waits and the model's time increment
are not isolated. GPU completion time, real-device frame-time p50/p95 and
acceptance are unmeasured. The latest full17-case/related E2E, real Mobile
34pairs/68images and L2/ci-required were not run by this diagnosis. Final
submission tests are separately recorded in the PR body with their exact SHA;
prior successes are never relabelled as current full success. No fifth
measurement run or production correction was performed in5D-1R.

## 7. Evidence preservation

The four raw trace files were retained locally outside Git with valid ZIP CRCs:

| Diagnostic run | Trace bytes | SHA256 |
| --- | ---: | --- |
| 01-night-main | 406043 | `ffc1ace080033c140eda67e39b4241815ea087db8d14f702ea012113f69d49d8` |
| 02-night-head | 418032 | `65514cca27bb87a8f7448d6166476b8e85dfa1f70705853170bc15c991e87203` |
| 03-touch-head | 1124588 | `3d59ac2566baa4b4aa452ac1981d15203aba69bfd36514f6eca67a2e958cc4a7` |
| 04-touch-main | 1056079 | `bcc24309c27507e1eda212ca06fd7e5ec4f1b340df863a423862535a6154f717` |

Local raw records also include result.json, steps.json, probe.json,
processes.json, render.ndjson, API/frame analysis, build/source hashes,
matched-resource/QTE details and initial failures. They are not represented as
publicly uploaded PR assets. The complete local Markdown report SHA256 is
`6414b7d007deace501151da1c9b4c3f7782ab88858ce76295a85113fc11cd182`.
Raw images/logs were not bulk-added to Git. New rod/reel screenshots are normal
Playwright attachments in Regular B; the existing workflow uploads
`test-results/` into `ci-<run>-<attempt>-<validationSHA>-regular_b`.
The Mobile lane must produce its unchanged34pairs/68images separately.

## 8. Conditional verification-environment migration

The diagnostic recommendation was STOP pending a measurement-load control
(four B runs; about9-10min lifecycle time plus analysis) or a separately
approved lower-level tracing/environment investigation. None was run.
The user PM instead expressly authorized one PR with these unresolved
failures delegated to **unchanged GitHub L2**. This is a limited migration of
verification, not a declaration of an environment-only defect or a blanket
waiver of local/CI failures.

Merge judgment requires L2 Unit/Build, exact340IDs (A104/B178/Mobile58), all
three lanes passing without skip/retry/flaky/expected-fail, real34pairs/
68images, exact source/provenance, two-parent validation merge, the same build
artifact, final ci-required success, plus PM/user real-device acceptance.
No CI/workflow/quality contract is weakened. Codex creates one independent PR,
reports its URL and HEAD and stops; CI review belongs to PM. No CI polling,
merge, deployment or next-Phase work is permitted.
