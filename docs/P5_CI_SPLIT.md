# P5 Regular E2E 分割の設計・検証記録

## G0 / G1（実装前、2026-11-01）

- 対象は既存の本Codexチャット、新規P5独立PR。推奨モデル/思考: Codex / 高。
- 指定および確認済みremote/main: `fca2a592e5520b57ee98465db4ddadb0a3d49f13`。
- 開始時checkout: `dae7faa0585343e751eb63e6eebe648f7101fe42`、clean、未追跡なし。
  既存 `work` と `feat/barb-initial-game` を保持し、既存checkoutで指定SHAから
  `codex/p5-regular-e2e-split` を作成した。worktree追加なし。
- open PR 0件。直近15 Runは全てcompleted。最新main Run
  [41304330162](https://github.com/tk0mygit/barb/actions/runs/41304330162) はsuccess。
- `AGENTS.md`、`CODEX_OPERATING_RULES.md`、`TESTING_WORKFLOW.md` は開始checkoutから
  指定mainまで差分なし。指示書との衝突なし。変更は必ずL2。
- 承認範囲は調査・設計・CI実装・局所検証・PR提出まで。実CI判定は8th_PM、
  マージ・デプロイ・後続工程・引継ぎ作成は本作業の対象外。

## 変更影響行列と各層の成功条件

| 層 / 全呼び出し元 | 直接変更 | 間接的観測差 / 必須証跡 / 成功条件 |
| --- | --- | --- |
| ゲーム状態・確率・時計、保存・売価 (`src/game`) | なし | 仕様・公開QTE設定を維持。runnerのCPU条件による時間変動のみ |
| 入力アダプター (`src/input`) | なし | PC/タッチ操作・解除条件を維持 |
| カメラ・描画 (`src/rendering`, `src/world`) | なし | 独立runnerのWebGL差は既存判定のまま扱う |
| HUD/DOM (`src/ui`) | なし | 期待値・画像品質・レイアウトを維持 |
| 撮影 (`tests/browser/mobile-performance.spec.js`, fixtures) | なし | Mobileに1specを固定、PRの34組/68画像、実SHA/raw captureを維持 |
| 比較器 (`compare-mobile-performance.mjs` と source検証) | なし | `compareMobileCapturesWithSources` は撮影後・集約器・CLI・既存Unitで引き続きawait。実sourceから再演算 |
| リスク分類 (`ci-risk.js` → prepare / run / required) | なし | 元のL0/L1/L2、実merge二親、完全inventory・両smokeを維持 |
| 分割CLI (`ci-e2e.js` → workflow / Unit / summary) | 3laneとprofile追加 | Buildの未分割収集1回を正本とし、各lane収集・実行が担当IDと完全一致。schema/hash/contextを再計算 |
| Artifact (`ci-artifacts.js` → prepare / run / summary / Unit) | lane名・record契約更新 | run/attempt/SHA/PR/ref、全ファイルhash、同一build record、別directoryを検証 |
| 最終ゲート (`ci-summary.js` → workflow / Unit / Mobile Unit) | 4job・3lane | needs exact keys、active artifact exact set、各ID exactly once、Mobile再検証をawait |
| Workflow / 末端CLI | 明示的A/B別job | Buildだけに依存する独立runner、workers=1、失敗seal/upload診断、例外はexit 1 |
| Unit / Build | CI用Unit更新のみ | npm ci / npm test / npm run build必須。合成fixture成功を実E2E成功と表示しない |

現行の実行経路は `build → e2e_regular / e2e_mobile → required`。
変更後は `build → e2e_regular_a / e2e_regular_b / e2e_mobile → required`。
record / artifactName / readRecord / executionPlan / validateLaneCollection /
validateAggregate / verifyArtifacts / writeSummary の参照はscripts・Unit・workflow・検証文書を検索した。

## イベント別の判定（実装前に固定）

| イベント | Regular A / B | Mobile | Pages |
| --- | --- | --- | --- |
| PR L2 | 元inventoryの全Regularを完全分割 | 全1spec・PR比較34組 | なし |
| PR L1 | 元の両smoke＋関連specを固定所属へ。空laneはrunnerもartifactもなし | 選択された場合だけ | なし |
| PR L0 | 全skip | skip | なし |
| main push | 全skip | skip | Unit/Buildとrequired成功後、同SHAからのみ |
| workflow_dispatch | 全Regularを完全分割 | 全1spec（PR比較とは表示しない） | なし |

cronは無効のまま。両smokeの存在はlane単体でなく原本selectionで検証する。

## 最終ゲートのfailure matrix（実装前に固定）

| 故障 | 必須の拒否 |
| --- | --- |
| Buildまたは任意active laneのfailure / cancelled / skipped / 未実行 | needs / 必須step / resultを拒否。1lane成功では代替不可 |
| needs不足・余剰・旧regularキー、旧schema / record | fail closed |
| 非active laneのjob起動、artifact IDまたはdirectoryの出現 | 意図しない実行として拒否 |
| artifact ID重複、directory不足・余剰、seal/upload失敗 | needs成功と完全artifact集合を要求し拒否 |
| SHA/ref/PR/run/attempt/merge親・build record不一致 | context / revalidatePlan / hashで拒否 |
| plan/profile/schema/hash改竄、A/B重複、spec欠落、Mobile横取り | 同commitの再計算と全inventory/選択の完全分割で拒否 |
| ID欠落・重複・同件数の別ID・別file | 原本と各lane、収集union・実行unionの両方で拒否 |
| zero / skip / expected-fail / flaky / retry / results 0または2 / 非zero終了 / signal | 既存の厳格なPlaywright契約で拒否 |
| Mobile 67/69画像、ID差替、hash/source/camera改竄 | 68画像exact set、manifest、34組、実source再演算で拒否 |
| 最終セットアップ不成功、非同期reject | 成功表示を出さず、result CLIはexit 1 |

## Profileと初期割当

PR #55の出典Runは
[41301076135](https://github.com/tk0mygit/barb/actions/runs/41301076135)
（Regular 265件成功、HEAD `e8561ffa7f2473d2ec79e8e34c2ed9dcce928bce`、job 124832086355）と
[41293561796](https://github.com/tk0mygit/barb/actions/runs/41293561796)
（Regular 264成功/1失敗、HEAD `4a8205fc1e799e9a3b0e80006ccdf48194ad0147`、job 124809848234）。
失敗Runは時間の参考のみであり、成功基準ではない。

ログの265個の `[n/N] tests/browser/<spec>` から次テスト開始まで、
最後はpassedサマリーまでを各specに配賦し、2Runの算術平均を使う。
観測合計は2333830ms（38.8972分）、2538037ms（42.3006分）で全32specの和と一致。
内部test durationの厳密な実測ではなく、間の処理・失敗コストを含む。
指示書の割当をそのまま採用し、丸め前の値でA **20.3614分** / B **20.2375分**、
差 **0.1239分**。
直近成功Runとの直接比較は同じ265Regular+58Mobileの場合のみ。

profileをcoverageの正本にはしない。完全inventoryから所属を確定してselectionをfilterする。
未profileの新規specはファイル名順、完全inventoryでの推定負荷が低い側、
同値はAへ割当（既定見積60秒を順次加算）。
未profileとinventoryから消えたprofileの項目をexecution-planとログへ警告する。
同じprofile・inventory・selectionから常に同じ計画となり、runnerで実行時負荷を測って再配置しない。

| Regular spec | 所属 | 平均観測分 |
| --- | --- | --- |
| `achievement-notice.spec.js` | B | 0.0348 |
| `achievements.spec.js` | B | 0.0753 |
| `audio-gain.spec.js` | B | 0.0605 |
| `audio.spec.js` | A | 1.6845 |
| `autosave.spec.js` | B | 2.1325 |
| `bio-audio-quality.spec.js` | A | 0.4365 |
| `bio-audio.spec.js` | B | 0.6656 |
| `bio-sources.spec.js` | A | 0.0623 |
| `cast-visibility.spec.js` | B | 4.4582 |
| `collection-menu.spec.js` | A | 0.3916 |
| `day-night.spec.js` | A | 2.0564 |
| `depth-time.spec.js` | A | 0.2911 |
| `equipment-game.spec.js` | B | 1.1808 |
| `equipment-ui.spec.js` | B | 0.3241 |
| `final-stability.spec.js` | A | 0.9703 |
| `fish-assets.spec.js` | B | 0.6158 |
| `fish-image-loading.spec.js` | B | 0.1738 |
| `fish-sales.spec.js` | A | 1.4354 |
| `fishing-spots.spec.js` | A | 1.1352 |
| `fishing.spec.js` | B | 5.3219 |
| `game.spec.js` | B | 1.1329 |
| `lake-scenery.spec.js` | B | 1.7816 |
| `mobile-layout.spec.js` | B | 0.3355 |
| `night-fog.spec.js` | B | 1.5815 |
| `qte-economy.spec.js` | A | 0.6422 |
| `qte-operations.spec.js` | B | 0.3402 |
| `qte-production.spec.js` | A | 6.1174 |
| `qte-public-on.spec.js` | A | 4.6590 |
| `sale-notice.spec.js` | B | 0.0225 |
| `save-data.spec.js` | A | 0.0148 |
| `smoke-pc.spec.js` | A | 0.2377 |
| `smoke-touch.spec.js` | A | 0.2269 |

## Artifactとschemaの契約

独立PRの各Runは次の4名（非active lane分は存在しない）を使用する。

- `ci-${run_id}-${run_attempt}-${validation_sha}-build`
- `ci-${run_id}-${run_attempt}-${validation_sha}-regular_a`
- `ci-${run_id}-${run_attempt}-${validation_sha}-regular_b`
- `ci-${run_id}-${run_attempt}-${validation_sha}-mobile`

`merge-multiple: false`、hidden files、14日保持、欠落upload失敗を維持。
risk planのschemaVersion 1は維持し、execution planとjob recordは2へ更新して旧契約を拒否する。
execution-planにはinventory、selectedSpecs、全所属、lane→spec、profile version/hash/出典/規則、
fallback警告、推定負荷を保存し、buildと全runnerで再計算結果まで完全一致させる。

## G3 局所検証

| 検証 | 結果 |
| --- | --- |
| `npm ci --cache /tmp/barb-p5-npm-cache` | PASS、lockfile変更なし |
| `npm test` | 984/984 PASS（失敗0、skip0）。分割profileの追加安全性は最終対象Unitでも再確認 |
| 最終集約・workflow追加Unit | 26/26 PASS（Mobile選択L1、独立job、旧契約拒否、設定維持を含む） |
| `npm run build` | PASS。既存の500kB chunk警告あり |
| PR相当の原本 `--list` とA/B/Mobileの独立 `--list` | 33spec、323 ID完全一致。A15spec/104、B17spec/161、Mobile1spec/58。欠落/余剰/重複0 |
| PR L1（ambient-output）の原本と分割収集 | 両smoke＋関連4spec、35 ID。A3spec/31、B1spec/4、Mobile意図的skip。欠落/余剰/重複0 |
| workflow_dispatchの原本と分割収集 | 全33spec、286 ID。A104＋B153＋Mobile29、欠落/重複0。PR比較ケースの有無は既存条件どおり |
| PC / touch smoke実E2E | 2/2 PASS、worker 1、retry 0、既存timeoutのまま。system Chromium使用、約1.6分 |
| YAML parse / workflow形状 / `git diff --check` | PASS。3 E2E jobsはbuildだけに依存し、requiredは4jobを要求 |
| `src/`、既存browser spec/fixture、package/lock、Playwright設定、比較器/source検証モジュール | 全て差分なし |

原本収集はlaneの報告を使わず、PR相当条件でフィルターなしのPlaywright JSONから取得した。
実装後の再収集も同一ID/file集合で、各laneの収集とexecution-planを照合した。
収集確認は実E2E成功の代用ではない。local smokeの実行JSONも全期待ID・単一passed試行・retry 0を検証する。

最終ゲートの局所故障注入は、各job failure/cancelled/不正skip、needs不足/余剰/旧regular、
schema/hash/別HEAD/PR/run attempt改竄、全lane artifact欠落、directory余剰、manifest欠損/追加/改竄、
画像バイト改竄、ID欠損/差替/横取り/重複、skip/expected-fail/flaky/retry/results 0/2/終了非0/signalを拒否。
34組の実source再演算を行う合成fixtureの既存負例を維持し、67画像欠損と69画像目の追加を拒否した。
実Playwright reporterのブラウザー不要probeを3laneで実行してsealし、最終artifact gateとresult CLIのexit 0を確認。
同じartifact経路でMobile実sourceを欠くprobeを与え、非同期rejectが失敗summary・CLI exit 1に到達することも確認した。
seal/upload失敗はjob失敗としてneedsが拒否し、artifact ID欠損も全laneで拒否する。

### 初回失敗と環境修復（記録を保持）

- 初回の `npm ci` は既定cache `/home/agent/.npm/_cacache` を作成できず失敗した。
  writableな `/tmp` のcacheへ変更して成功。package/lockは変更していない。
- 初回の収集はsandbox内の子Git起動が `EPERM` で失敗。同じspecのまま、必要な実行環境権限で再実行した。
- 初回の全Unitは977成功/1ファイル失敗。既存の `lake-scenery-comparison.test.js` が参照する
  `eb10aa13ec302a7a4c9b4a421a596f447c8f6e7c` がローカルGitに未取得だった。
  そのcommitをfetchし、既存テストを変更せず全982件PASSを確認。その後追加した集約/設定検証もPASS。
- browser spec、assertion、timeout/retry、品質/DPR等を変更して失敗を隠していない。

### 未実行と実CI判定の境界

Regular A/Bの実全件E2E、Mobileの実撮影34組/68画像、GitHub上の新PRのci-required、
実validation mergeの二親と統合可能性、速度/queue/総Runner分/セットアップ重複コスト、実機は未確認。
ローカルのUnit/合成Mobile gate PASSは、それらの実CI PASSを意味しない。
約20.36/20.24分は履歴からの推定で保証値ではない。8th_PMが同じ265Regular＋58Mobileを
最新HEADのGitHub L2で確認し、全CI時間と総Runner分を併せて評価する。
PR作成後はCI完了待機・継続ポーリングを行わず停止する。
