# Sky-5 / PR #86 Regular A・Bの局所是正

## 着手と適用範囲

- 既存Sky-5チャット／同一ブランチ `codex/sky5-celestial-achievements`／PR #86。推奨はCodex・高思考。
- 着手HEADは `678d2e05a070225c34ba6cff828b4f9826504a24`、着手時・提出前のfetch後mainは指定基準 `65021907bf06f5a0f765af9ea18dc5f91d43289b` と一致。着手時の作業ツリーはクリーン。
- 対象は完了済みRun `43543265760` attempts 1/2の是正・証跡取得。分類L2を維持。同じPRへのpushと結果報告まで。CI監視・待機・再実行、マージ・デプロイは行わない。

## 是正前の変更影響表

| 領域 | 直接変更の計画 | 間接影響／保護する検証 |
| --- | --- | --- |
| 正規保存のE2E | fishing.specの捕獲後保存2箇所を正規実績契約の定義に追従 | 外側V3/revision3、捕獲・QTE・画像・reload・36種の連続checkpoint検査を維持 |
| 正規実績UIのE2E | equipment-gameの強化直後とreload後の総数を定義19件に追従 | 解除数2、売却・強化・入力・画面位置・保存の全assertionを維持 |
| 旧形式・移行元 | 変更しない | 契約5の正規17件、V1/V2/rev1/rev2、旧日時、未来保護、移行元fixtureを維持 |
| Rare発見390×844 | まず元PNG/trace/diagnostics、旧mainとPR、時計・アニメーション・DPRを対照 | 根因を確認するまで描画・画素assertion・閾値を変更しない。UI fixtureには通常の観測ループがないことも確認 |
| Regular Cの色ベクトル | attempt1ログとattempt2、旧main/PRの同一時計を調査 | CPU DoubleとGPU Float32提出値を分けて確認。広域epsilon・比較器例外を追加しない |
| 天体・時計・入力・釣り/QTE・HUD | 当初の是正はsrc無変更 | 観測0.5/0.1秒、skip/pagehide、抽選・資源、未解除名秘匿を既存局所テストで確認 |
| 原典・source pins・撮影→比較CLI→ci-required | 変更しない | runtime treeの固定、34組/68画像、非同期拒否・CLI nonzero、既存CI分類を維持 |

## 期待値の全体監査

| 箇所 | 分類 | 対応 |
| --- | --- | --- |
| fishing.spec.js:505 / :532 | 現在の本番捕獲後保存 | `[3,3,5]` の実績契約だけを正規定義へ追従 |
| equipment-game.spec.js:191 / :221 | 現在の本番実績画面（強化後／reload後） | `解除済み 2 / 17` の総数だけを正規定義へ追従 |
| celestial-achievements.test.js の旧契約5・17件 | 実際の基準mainから作る源版 | 保持。新6契約へ移行し日時保持・観測未解除を検証する役割 |
| save-v3-revision3.test.js のrev2×契約5 | 既知版の誤組合せを拒否する負例 | 保持 |
| achievements.spec.js の解除済み17カード | 捕獲・装備の旧17件をすべて達成し、観測2件だけ未解除の中間状態 | 保持。総数19件とは意味が異なる |
| fixtures/saves・phase6履歴・原典pin | 歴史的wire版／固定原典 | 一括置換しない |

## 局所設計と変更

`fishing.spec.js`の現在の捕獲後セーブにだけ`ACHIEVEMENT_CONTRACT_VERSION`を使用する。外側のsaveVersion 3 / rosterRevision 3、捕獲順、QTE回数、画像、reloadの期待はそのまま。`equipment-game.spec.js`の現在の実績UIにだけ`NORMAL_ACHIEVEMENTS.length`を使用し、解除件数2は固定したまま、強化直後・reload後の双方を検査する。19定義と旧17定義の不変性は別の実源版Unitで固定するため、これらの定数参照で仕様の誤変更を無検知にしない。

src、共通fixture、画像比較CLI、最終ゲート、CI・依存・設定は変更しない。本番src treeは是正前と同じ`4134216b8067fbbfce7ff44ea25587975d8e7c35`。

## 証跡取得・切り分け（着手時）

指定RunのPR HEADは両attemptとも着手HEAD。attempt2検証mergeは
`87f324c7e0f78e8d59b3f27a2019f8ef988a41a3`（親は基準mainとPR HEAD）。

- attempt1: Regular A job `132289355894`、B `132289355864`、C `132289355886` が失敗。
- attempt2: A `132304967552`、B `132304967546` が失敗、C `132304967501` は成功。
- 完了済み各ジョブログを取得して照合: Aは両attemptとも162成功/3失敗/6未実行、Bは両方167成功/2失敗。Cはattempt1が159成功/1失敗、attempt2は160成功。これらは旧HEADの結果であり、今回是正後の成功とは扱わない。
- artifact一覧はattempt2のA/B/C/Mobile/buildの5個だけ。attempt1のZIPは取得できていない。ログで補完し、元画像未取得を成功扱いしない。
- attempt2 A artifact `14095524026`、名前に上記Run/attempt/mergeを含む。接続ツールはZIPを生成したがFile Service取得先とGitHubのartifact転送先が通信制限で403。元ZIP/PNG/traceのローカル取得は未達。
- Aの公称ZIPは65,589,911 bytes / SHA-256 `c087d7f1fb728a1e8356c13eeb484f1629d9bd8772f40a6197f07a64ca73ba24`。元バイトを取得できていないため、このdigestとの実照合は未実施。
- attempt1 Cのuploadログにはartifact `14093279280` / 154,038,013 bytes / SHA-256 `395027f886daa409e4ea51947ebaf105343cc08b1d15ebdd391727f1ef2f5bca` が残る。attempt2 Cは `14096272717` / 140,429,910 bytes / `0f94b7321a9548a93bfe38e122a56465bfaf735646d9d73201c0ad9818553c2b`。upload成功ログと現在取得できる元バイトは区別する。
- attempt1 Cのartifact IDをGitHub RESTで直接照会した結果もHTTP 404。現在の一覧取得はtotal_count=5/取得5であり、ページ漏れをattempt1未取得の説明にはしない。元証跡の回収不能を理由にassertionを緩和しない。
- PMは通信設定を変更せず切り分けを継続する選択を回答した。通信許可を拡張せず、取得済みジョブログ・ローカル対照と元証跡未取得の制約を併記する。

実験ログと取得物は `/tmp/barb-pr86-*` および `test-results/pr86-*` に保存し、生成物をコミットしない。

## C: Rare発見の対照実験

- `git archive`で基準mainを別ディレクトリへ展開し、同じlockfile由来のPlaywright 1.64.1とChromium 154.0.8037.57で元の390×844テストを実行した。mainとPRで各1件成功。DPRは元設定の1、同じ停止時計・safe inset・文字サイズ・200/1030/1500msのWAAPI seek。`<`の画素比較を含めassertionは無変更。
- species-discovery.spec、ui-fixture、fish-image-driver、species-discovery-notice、style.cssは両SHA間で差分0。このspecのUI fixtureはmain.jsを読み込まず、Sky-5の本番観測ループを実行しない。通常描画ループの差がこのfixtureで発生するという説明は採らない。
- 各10枚のローカルPNGのうち8枚はbyte一致し、問題の比較時点1500msのblack-bass/peacock-bass画像はいずれも完全一致。相違2枚も隠さず記録: black-bassの200msは1画素/最大1階調、cleanup後3000msは1,856画素/最大6階調（矩形149,267〜239,321）。これは同条件ローカル画像の比較であり、取得できていないCI元画像との差の説明ではない。ハッシュ一覧は`/tmp/barb-pr86-discovery-image-comparison.json`。
- 座標/RGBを保存するためJSON reporter付きで各SHAを追加1回実行し、両方成功（各SHA計2回、retry設定は0のまま）。両魚・両SHAでbounds `(21,129.296875,348,583)`、sample `(29,704)`、背景ありRGBA `[19,53,51,255]` / なし `[23,61,56,255]`、合計`123 < 140`が一致。中心はblack-bass `[49,51,37,255]`、peacock-bass `[59,57,38,255]`で背景切替前後が完全一致し、before/afterのgeometryも不変。`/tmp/barb-pr86-discovery-pixels.json`に保持した。CIで両方140となる状態との差は未説明のまま残す。
- CIはChromium 156.0.8078.4 / Node 24.22.2、ローカルは154.0.8037.57 / Node 24.19.0。CI両attemptの`140 == 140`をローカルで再現したとは扱わない。ブラウザー・compositor差、サンプル点のクリップ等は未確定の仮説であり、元PNG/trace未取得のため根因は未解決。テスト・製品描画・閾値を変更しない。

## D: Double値と提出精度の対照実験

- attempt1 Cのログは色3成分のうち赤・青の最下位桁差であることを確認。160件中159成功・1失敗。attempt2 Cの同一HEAD成功と別記し、成功を根因解消とはしない。
- ログのExpected/Received色もMath.froundすると双方`[0.11340390890836716, 0.8193686604499817, 0.5531314611434937]`。この一致はログ数値の丸め計算であり、そのCI実行のGL uniformを読み取った証跡ではない。
- 旧main/PRのaurora.jsとgame-clock.jsは同一ソース。test-onlyスクリプトで実ソースの純粋sampler部分をNode/Chromiumへ独立に読み込み、night 4 / CLEARの1620〜1799.9990234375秒を1/1024秒刻み（184,320入力）で比較した。両SHAともCPU Double差1,743行、Math.fround後の差0行。例: 1620.0908203125秒の赤はNode `0.08169953254020682`、Chromium `0.08169953254020683`、Float32は双方 `0.08169953525066376`。
- aurora.js SHA-256: `6235975d852c0914d3134239455e65a7cde84658693e165236f4fe352929c454`、game-clock.js: `579ea9309ab90b8d888024bd12184c3e1673a51bd25c4fa7f6201960492dbe92`。結果は`/tmp/barb-pr86-math-probe.json`。旧mainにも同じCPU演算差が存在する証拠であり、CI失敗時の正確な時計入力を取得したものではない。
- `worldLight.water.light.color`はCPU側のuniform.valueのDouble配列。`gpuLight.color`は別の明示的GPU読取であり、既存比較CLI/R2検証は提出Float32の厳密比較を担当する。このsampler実験のMath.fround一致をGPU読取成功と呼ばない。既存色のDouble完全一致、directionのFloat32完全一致、GPU比較器、source pinsをすべて維持する。
- 元の夜間mouse操作ケースをPRの実ビルド、続いて基準mainの実ビルドで各1回実行し、双方成功（各1.6分、既存120秒のまま）。同じPlaywright/Chromium/DPR 0.5/初期時計1650秒で、テスト内の通常の時計進行・native操船/look/cast・色Double完全一致を維持。mainのHTTP配信indexはmain/distとSHA-256 `3ea7d81d84daba58a54b8da748ea526765f329a3cd6d79ff7959a3276777754a`で一致し、PR/distの`840acb6c560f203d27ca42cc2529d123562a993d130ffd8dce340466fb66ed35`とは異なることを確認した。PRのビルドを旧main対照へ流用していない。CIと同じ失敗時刻を再現したとは扱わない。

## 旧契約5・17日時のブラウザー回帰

基準mainの実ゲームソースで100捕獲・売却・両装備Lv.10を生成し、正規contract5/17件のsaveを作った。既存`openUIFixture`からPRの復元・UI・保存モジュールへ渡し、ブラウザー内のcreateSaveDataによる往復結果がcontractVersionだけ6へ変わることをdeepEqualで確認した。17件すべてのID/解除日時・他のsaveフィールドは完全一致。実績UIは`17 / 19`、旧17カードと元datetime、新2件は`？？？`、通知なしを確認した。

これはDOM/domain fixtureでの追加probe（1回成功）であり、本番main.jsの2スロットautosaveを実行したと主張しない。本番捕獲→保存→reloadはA/Bの既存ケース、2スロット・未来保護・無書換えloadはUnitで検証した。証跡は`test-results/pr86-contract5-ui-probe/`、probeコードとログは`/tmp/barb-pr86-contract5-ui-probe.*`。本番API・履歴fixtureは追加/変更していない。

## 是正後の局所検証結果

実行対象は着手HEAD `678d2e05a070225c34ba6cff828b4f9826504a24`に本書記載の4期待値修正を加えた作業ツリー。src treeは上記固定値のまま。提出コミットはこの検証済みtest差分と本記録だけを確定する。局所Chromiumは154.0.8037.57、Playwright 1.64.1、Node 24.19.0、workers 1。実描画の重い検証と全件Unitは競合を避けて順次実行した。

| 検証 | 結果／ログ |
| --- | --- |
| npm ci（`--cache /tmp/barb-pr86-npm-cache`） | 成功。依存・lockfile無変更、`/tmp/barb-pr86-npm-ci.log` |
| npm test | **1325成功、失敗/cancel/skip 0**（272.7秒）、`/tmp/barb-pr86-unit.log` |
| npm run build | 成功。既存chunkサイズ警告のみ、`/tmp/barb-pr86-build.log` |
| A/B是正: fishing + equipment | **10成功**（19.5分）。arapaima、36魚種6区間＋最終図鑑/保管/reload、mouse/touch取引。CIで未実行だった後続6件も含む。`/tmp/barb-pr86-ab-corrected.log` |
| 観測実績 | **22成功**（8.0分）。最低0.5/0.1秒・実draw・PC FPS/TPS・touch縦横・部分観測中断・pagehide・18x除外/1x復帰・非当選/霧・描画失敗・通知・保存/reload。`/tmp/barb-pr86-celestial-regression.log` |
| 実績UI・保存UI・PC/touch smoke | **11成功**（58.7秒）。未解除名秘匿・旧日時・通知・V1復元を含む。`/tmp/barb-pr86-ui-save-smoke.log` |
| 既存SkyCheck + PR day-night対象 | **5成功**（2.0分）。PC/touch縦横ONの境界/入力遮断、OFF/pagehide、PR夜間mouse。`/tmp/barb-pr86-skycheck-daynight.log` |
| C旧main/PR同条件 | 各SHAの同一1ケースが初回・JSON診断で各2回成功。画素`123 < 140`を維持。`/tmp/barb-pr86-{main,pr}-discovery*.log` |
| D旧main実ビルド | 対象1件成功（1.6分）。`/tmp/barb-pr86-main-daynight.log` |
| 実源版contract5/17件→6/19 UI probe | 1回成功。全17日時と他フィールドが完全一致、新2件未解除・通知なし |
| 差分・原典 | `git diff --check`成功。src/scripts/CI/設定/依存/歴史fixtureの差分0 |

ローカル全件E2E、CI Chromium156でのC再現、実34組/68画像の新規撮影、実機Chrome/Braveの操作・聴感は未実施。source replayの合成Unitは実画像・GitHub CIの成功を代替しない。CI元PNG/trace/diagnosticsは未取得。

## 結論と停止範囲

A/Bの確定原因である正規期待値更新漏れは是正し、元の捕獲・QTE・画像・保存・reloadを保った対象検証を通した。CはCIの画素境界の根因未解決、DもCI失敗時点の正確な原因は未確定。**全件成功・新HEADのci-required成功とは主張せず、L2受入未完了／マージSTOPを維持する。**

是正差分を同一PR #86へpushし、PR本文へ最新HEADと実行/未実行・証跡制約・残留リスクを記載して終了する。新HEADのL2全Regular/Mobile、34組/68画像、ci-requiredはPMの確認対象。CI待機・監視・再実行、マージ・デプロイは行わない。
