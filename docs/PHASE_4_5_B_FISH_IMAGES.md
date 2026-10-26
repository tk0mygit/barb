# Phase 4.5-B 魚画像の読み込み・描画検証

作業開始時に `git fetch origin main` で確認したmainは
`407f5aad5eb7733be662094f30d9e2dca8414c55`。このmainと本PRのUIを比較した。
ゲームの抽選・状態機械・売価・通貨・セーブv1・12枚のPNG・CI設定は変更していない。

## 表示と読み込みの契約

- RESULTの切り替え・終了時に旧画像を非表示にし、DOMから外す。
  ロード・デコード後、魚種ID、釣果ID、要求世代、RESULT状態、active、dialog.openが
  すべて一致する場合だけデコード済みの要素をフレームへ挿入する。
- 読み込み中は「画像を読み込み中…」、失敗時は「画像を表示できません」。
  フレームの寸法は既存CSSのままで、読み込みの成否は保管・売却・進行を妨げない。
- 保管ボタン・Esc・native close・売却成功・非アクティブ化・次の釣果は要求を無効化する。
  native closeのイベント到着前にHUDが更新されても、閉じた結果を再表示しない。
- BITE以降の同一遭遇では先読みを1回だけ開始し、RESULTで同じPromise・デコード済み要素を使う。
  セッション内のLRUは最大2魚種。追い出した未完了画像のsrcを外し、失敗はキャッシュから削除する。
  画像・Promiseはセーブに含めない。
- 図鑑・保管・詳細では、画像フレームが `#collection-content` に実際に交差するまでsrcを設定せず、
  `loading=lazy` を維持する。最初の可視画像だけ先に `eager/high` で開始し、完了後は可視画像を
  最大2件ずつ `eager/auto` で読み込む。詳細画像も最初の可視画像として扱う。
  スクロール・画面回転で交差した画像を追加し、画面遷移・閉鎖では監視と未完了の読み込みを解除する。
- 未発見カードは従来のシルエット・lazy表示を保ち、名前・説明・魚種ID・魚PNG参照をDOMに出さない。
  `fish-assets.spec.js` の全画像lazyという前提を、上記の可視範囲の契約へ更新した。
  新規E2Eでは先頭取得中に他のsrcがないこと、次の同時取得上限、不可視画像の未取得、
  スクロール後・詳細の読み込み、既存E2Eでは12魚種の全画像・透過・フレーム寸法を検証する。

## 性能測定

2026-10-26、Linux Chromium `154.0.8037.57`、1000×700、DPR 1。
CDPでlatency 150ms、download/uploadとも1,048,576 bytes/s。
画面ごとに新規Contextを5個作り、それぞれcold→同一Contextのwarmを測った。
実HTTPで本番PNGとUI・ドメインのソースモジュールを配信する専用ページを使い、WebGL負荷を除外した。
他の局所検証と同じホストを共有しており、CPU負荷・CDP通信による揺れを含む。

RESULTは実ドメインAPIでBITEまで進め、BITEから実時間1秒後にファイトを計算してRESULTへ進める。
この1秒は測定入力であり、ゲーム内の待ち時間やファイト条件は変更していない。
先読みの猶予が短い場合や回線がさらに遅い場合にはRESULTでもプレースホルダーが残る。
図鑑は12種発見済みの先頭ブラックバス、保管は12匹保管済みの先頭アロワナを測った。

以下はms、各セルは中央値／観測最大値。rAF値はデコード・可視性を確認した次の描画機会であり、
ピクセルが観測された正確な時刻とは区別する。B-0の最大値・warm値は依頼には提示されていない。

| 対象 | B-0 cold中央値 | 今回main cold rAF | 修正後cold rAF | main画像転送 | 修正後画像転送 |
| --- | ---: | ---: | ---: | ---: | ---: |
| RESULT | 815 | 812.7 / 830.0 | 41.8 / 97.5 | 771.2 / 781.0 | 775.7 / 785.4 |
| 図鑑先頭 | 3,719 | 3,761.8 / 3,802.0 | 826.0 / 846.2 | 3,722.9 / 3,745.8 | 785.2 / 807.4 |
| 保管先頭 | 2,465 | 2,488.6 / 2,568.8 | 629.3 / 651.8 | 2,439.0 / 2,463.8 | 573.0 / 609.5 |

画像転送はResource Timingのrequest start→responseEnd。RESULTの転送自体は短くなっていない。
修正前の要求開始はRESULTの約8～16ms後、修正後は約1,010～1,016ms前で、
responseEndはRESULTの約225～242ms前だった。
対象PNGのencodedBodySizeは修正前後ともブラックバス648,496 bytes、アロワナ407,085 bytes。
圧縮や画像内容の変更による改善ではない。

実際の魚ピクセルも、ブラウザーが合成したフレームのスクリーンショットで確認した。
次表は画面操作→スクリーンショット確認完了の上限値で、撮影・CDP転送の時間を含む。

| 対象 | main coldピクセル確認 | 修正後coldピクセル確認 | main warm rAF | 修正後warm rAF |
| --- | ---: | ---: | ---: | ---: |
| RESULT | 889.5 / 940.5 | 142.7 / 264.1 | 31.4 / 31.6 | 30.5 / 30.9 |
| 図鑑先頭 | 3,860.1 / 3,875.3 | 918.6 / 935.4 | 34.2 / 59.7 | 35.9 / 49.2 |
| 保管先頭 | 2,602.3 / 2,692.2 | 700.9 / 754.3 | 51.9 / 67.5 | 35.2 / 48.8 |

warm時の対象画像の追加転送は両実装とも0。図鑑warm中央値は1.7ms増加しており、
この差は1描画間隔（約16.7ms）より小さい。warmの撮影確認値はRESULTが
124.6 / 127.3→127.7 / 152.6ms、図鑑が112.4 / 161.2→108.0 / 147.3ms、
保管が140.4 / 177.0→129.5 / 141.2ms。warmでの速度改善率や厳密な同等性は主張しない。

再現コマンド（システムChromiumを使う場合は `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` を設定）:

```sh
node scripts/measure-fish-images.mjs --ref 407f5aad5eb7733be662094f30d9e2dca8414c55 --trials 5 --output test-results/fish-performance-before/report.json
node scripts/measure-fish-images.mjs --trials 5 --output test-results/fish-performance-after/report.json
```

両ディレクトリに全30測定の生データ・Resource Timingと各画面のPNGを残した。
値の分解能はrAF間隔・画像デコード・撮影処理・ホスト負荷に制約され、B-0との完全な環境同一性は保証しない。
性能の実機測定、タッチ端末の性能比較、全カードの読み込み完了時間は未測定。
不可視画像の節約と先頭優先のため、後続の可視画像の開始は先頭完了まで遅れる。

## 旧画像0フレームの証拠

新規 `fish-image-loading.spec.js` で前の魚を赤、新しい魚を青のPNGとして配信する。
前の赤い魚が描画されたことを先に確認し、異魚への切り替え時はネットワークを保留する。
imgのsrcやCanvasへの魚画像の転写ではなく、**ブラウザーの合成済みスクリーンショット**から
旧魚の色のピクセル数を数える。保留中の8枚と新画像表示後の1枚を各viewportで比較する。
warmの異魚切り替えも `Page.startScreencast(everyNthFrame: 1)` と即時ACKで捕捉する。

| viewport | 保留中＋表示後PNG | coldで受信した合成フレーム | warmで受信した合成フレーム | 旧魚を含む観測フレーム |
| --- | ---: | ---: | ---: | ---: |
| PC 1000×700 | 9 | 31 | 10 | 0 |
| タッチ縦 390×844 | 9 | 24 | 4 | 0 |
| タッチ横 844×390 | 9 | 22 | 8 | 0 |

結果は `test-results/local-fish-image-pixel-evidence/` 内のviewport別
`painted-frame-evidence.json` と `previous-bass.png`、`pending-*.png`、
`decoded-bluegill.png`、`warm-*.png` に保存した。
通常のウォーム切り替え、同魚連続、デコード保留、取得失敗・再取得、
ボタン／Esc／native close／売却／非アクティブ化後の旧要求完了、アワセ失敗後の次回釣果も検証する。

観測した旧魚表示は0。CDPの合成フレーム通知はドロップし得るため、全物理フレームを
漏れなく収録したという意味ではない。旧要素を同期的に切り離し、新要素はデコードと世代照合後に
初めて接続する実装上の不変条件と、ピクセル検査の両方で担保する。
実機Safari／Android／iOS、OS・GPUごとの物理画面は未確認。

## 検証範囲とCI

`npm ci`（書き込み可能な `/tmp/barb-npm-cache` を指定）、単体テスト560件、ビルドが成功。
初回のnpmは既定キャッシュ先の権限制約で失敗したため保存先を指定した。
初回の単体テストではsandboxによる子git実行の制限と参照用の過去commit不足を確認し、
実行権限を整え、テストが参照するcommitをfetchしてから全560件の成功を確認した。
初期E2Eで検出した非アクティブ化→再表示の競合はUI側の同期的な閉鎖処理で修正。
失敗時のtrace・PNG・diagnosticsは `test-results/local-fish-image-loading/` に保持した。

新規画像E2Eは12件を局所実行（11件＋追加したアワセ失敗1件）。
ピクセル証拠の保存処理を追加した後、該当3件を再実行して証拠を確定した。
既存の局所E2Eは `fish-assets`、`fishing`、`collection-menu`、`fish-sales`、
`save-data`、`smoke-pc`、`smoke-touch`、`mobile-layout` の8spec・24件がすべて成功（14.1分）。

```sh
npm ci --cache /tmp/barb-npm-cache
npm test
npm run build
npx playwright test tests/browser/fish-image-loading.spec.js --reporter=line --output=test-results/local-fish-image-loading-stream
npx playwright test tests/browser/fish-image-loading.spec.js --grep 'missed hook' --reporter=line --output=test-results/local-fish-image-missed-hook
npx playwright test tests/browser/fish-image-loading.spec.js --grep 'painted old-fish' --reporter=line --output=test-results/local-fish-image-pixel-evidence
npx playwright test tests/browser/fish-assets.spec.js tests/browser/fishing.spec.js tests/browser/collection-menu.spec.js tests/browser/fish-sales.spec.js tests/browser/save-data.spec.js tests/browser/smoke-pc.spec.js tests/browser/smoke-touch.spec.js tests/browser/mobile-layout.spec.js --reporter=line --output=test-results/local-fish-related
```

画像E2Eの最初のコマンドはアワセ失敗ケース追加前の11件で成功し、追加した1件は次のコマンドで成功。
ブラウザー検証では `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` を指定した。

想定分類は **L2**。複数UIと共通CSS／HTML、新規画像ヘルパー・spec・測定スクリプトを横断し、
L1許可リストに該当しない。分類器・ワークフローは変更していない。
ローカル全件E2E、Actionsの状態確認・完了待ち・再試行・マージは実施しない。
PRの最新HEADに対するActions全件E2Eと `ci-required` の確認はPM側のマージ前作業。
