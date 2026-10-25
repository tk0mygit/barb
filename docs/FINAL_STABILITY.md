# 最終安定化とスマートフォン受入（Phase 4C-2B）

検証対象の最新mainは `a22ce01531befa55230fb186579731b8a3b9aeb6`（Phase 4C-2A、PR #28）。
既存チェックアウトから `test/phase-4c-2b-final-stability` を作成しています。
本工程は既存機能の安定性検証と受入準備です。4C-2Aの描画解像度調整と「ON THE LINE」の
横長・低背HUDを維持し、魚画像・景観・ゲーム数値・セーブ形式を再実装しません。

自動検証の成功、実時間の連続プレイ、端末からの音声聴取は別の証拠です。
本PRだけでは実機受入もPhase 4C全体も完了しません。ChromeとBraveの実機確認、マージ後の
最終mainとPages公開状態の確認を経て、PMが完了可否を判断します。

## 対象と既存の保証

[検証フロー](TESTING_WORKFLOW.md)、[モバイル描画・HUD](MOBILE_PERFORMANCE.md)、
[音声](AUDIO_SYSTEM.md)、[保存](SAVE_DATA.md)を基準にします。
既存の単体テスト・E2Eを再利用し、同じ全シナリオを複製しません。

| 対象 | 既存の検証・今回の扱い |
| --- | --- |
| 釣り・タッチ入力 | `fishing.spec.js`、PC/タッチスモーク。キャスト準備とキャンセル、フリック、アワセ、長押し・解放、釣果、再試行を維持 |
| 時計・昼夜・霧 | `day-night.spec.js`、`night-fog.spec.js`。保存時計の初回描画、両境界、メニュー・blur・非表示中の停止を再利用 |
| 画面適応・HUD | `mobile-layout.spec.js`、`mobile-performance.spec.js`。縦横・小型・低背、セーフエリア模擬、文字拡大、HUDの非重複・タッチ透過、回転、WebGL context lossを再利用 |
| 保存・経済 | `autosave.spec.js`、`save-data.spec.js`、`fish-sales.spec.js`、装備・図鑑・実績関連specと単体テスト。v1、2スロット、重複取引防止、復元と保護を維持 |
| 音声 | `audio.spec.js`、`audio-gain.spec.js`、音声単体テスト。Fake AudioContextの失敗経路とネイティブChromiumのgraph/gain検証を区別 |
| 今回追加する保証 | 同一セッションでの操作反復、複数周期との組合せ、同条件の描画リソース比較、復帰時の音声再試行反復。具体的な実行結果は下表 |

## 検証環境と実行結果

<!-- automatic-results:start -->
2026-10-25、Debian GNU/Linux 13、CPU割当2コア、Node v24.19.0 / npm 11.9.0 /
Chromium 154.0.8037.57、headless・SwiftShader。実機・実GPUの性能測定ではありません。

| 検証 | 実行結果・実時間 |
| --- | --- |
| `npm ci --cache /tmp/barb-4c2b-npm-cache` | 成功。依存関係・lockfile変更なし |
| `npm test`（最終内容） | 447件成功、失敗/skip 0、13.06秒 |
| `npm run build`（最終内容） | 成功。ビルド230ms、既存Three.js chunkサイズ警告あり |
| `audio.spec.js` + `audio-gain.spec.js` + PC/Touchスモーク | 26件成功、163.83秒。うち音声24件 |
| `mobile-layout.spec.js` | 1件成功、ケース22.93秒。回転・低背・模擬safe area・文字拡大・HUD・context loss |
| `final-stability.spec.js`（最終版） | 1件成功、ケース77.91秒（診断内シナリオ77.78秒）、起動/終了込み79.65秒 |
| 保存・経済・装備・メニュー・昼夜/霧の選択回帰 | 12件成功、121.58秒 |
| 局所E2E合計 | 40件成功。成功runのskip/unexpected/flakyは0。初回未成功は下記で別記 |
| ローカル全件E2E | 未実行。`--list`のみ24 spec・147件を収集 |
| CI分類の局所確認 | 既存判定器がL2（新規spec）。実際のPR merge ref/CI結果はPM確認待ち |
| 実機Chrome/Braveの聴取・15〜20分 | 未確認 |

選択回帰12件は、`autosave.spec.js`の実FIGHT再読み込み/破損した最新スロットからの復元/quota回復、
`collection-menu.spec.js`の移動中メニューと入力解除、`day-night.spec.js`の両境界と停止/復帰、
`equipment-ui.spec.js`のPC/タッチ購入・次回性能と古い確認の拒否、`fish-sales.spec.js`のPC即時/個別/一括売却・二重売却拒否、
`night-fog.spec.js`の両境界fadeと保存復元、`save-data.spec.js`のPC/タッチ復元です。
未選択の既存specと4C-2Aの全画面比較は今回のローカル成功件数に含めません。

新規の継続ケースは、DPR 1の初回実行で3回捕獲・全4資源標本まで通過した後、復帰検証中に
120秒制限を超過しました（ケース120.96秒、未成功）。ゲームのconsole/page errorは0でした。
既存のSwiftShader負荷対策に合わせてDPR 0.5へ下げ、FIGHTのphase/tension観測を同じ読み取りへまとめました。
全assertion・操作回数・120秒制限を維持し、最終版は全工程成功。画質比較は既存の実DPR検証の責務のままです。
タイムアウトで閉じられたpageのCDP終了処理も、元の失敗へ追加例外を重ねないよう調整しました。
初回のJSON/trace/PNGは`test-results/final-stability-mobile/`に保存し、成功資料で上書きしていません。

実行準備時は既定npm cacheの書き込みに失敗し、書き込み可能な`/tmp` cacheで`npm ci`が成功しました。
初回の制約付き`npm test`はCI基盤2ファイルが未成功でした。実行環境の権限を調整した実行と最終実行は
各447件成功であり、単体テストの削除・緩和はありません。最初のログも保持します。

今回追加した2ケースの実行時間は音声3.244秒＋継続77.905秒＝約81.15秒です。
既存シナリオの複製や15〜20分の実時間待機は追加していません。得られる保証は、中断後の音声再試行の反復と、
捕獲/保存/時計/リソースを同じセッションで横断する検証です。過去PR #28の約40分と今回の局所値は
環境・実行範囲が違うため、CI増分の実測とは扱いません。CI時間は未計測で、PMがrun/attempt/HEAD・
base比較を含む実際の収集件数を記録します。CIで追加されるbase比較ケースも、ローカル147件とは区別します。

再現コマンド（既存Chromiumを使用する環境では`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`を指定）：

```sh
npm ci --cache /tmp/barb-4c2b-npm-cache
npm test
npm run build
npx playwright test tests/browser/audio.spec.js tests/browser/audio-gain.spec.js tests/browser/smoke-pc.spec.js tests/browser/smoke-touch.spec.js --reporter=line --output=test-results/final-audio-smoke
npx playwright test tests/browser/mobile-layout.spec.js --reporter=line --output=test-results/final-mobile-layout
npx playwright test tests/browser/final-stability.spec.js --reporter=line --output=test-results/final-stability-verified
npx playwright test tests/browser/autosave.spec.js tests/browser/save-data.spec.js tests/browser/equipment-ui.spec.js tests/browser/fish-sales.spec.js tests/browser/collection-menu.spec.js tests/browser/day-night.spec.js tests/browser/night-fog.spec.js --grep 'corrupt newest|reload during a real fight|quota failure|restored domain|equipment levels|cancel/back|menu freezes a moving boat|mouse: immediate|lighting crosses both|fog fades at both' --reporter=line --output=test-results/final-regression
```

局所の実行レポート・単体/ビルドログ・分類/収集記録は`test-results/final-stability/`、
成功した継続/資源JSONは`test-results/final-stability-verified/`、音声添付は`test-results/final-audio-smoke/`、
画面適応の成功資料は初回混在runの`test-results/final-stability-mobile/mobile-layout-*/`にあります。
局所資料は`browser-test-results`として別途まとめ、CIでは既存の同名artifactへ自動保存されます。
<!-- automatic-results:end -->

ローカル全件E2Eは実行条件にしません。新規spec・複数領域の検証追加・未知の文書パスを含むため、
最終分類は既存のCI判定器に従います。PMは最新HEADの `ci-required` と実際の収集・実行件数を
確認します。CodexはCI完了待機・継続ポーリング・マージ・デプロイを行いません。

## 継続操作と時間経過

1セッション内で操船、停船、釣り視点、ルアー選択、準備・キャンセル、キャスト、アワセ、
ファイト、ランディング、保管または売却、図鑑・保管・装備確認、保存確認、操船復帰を反復します。
同じ釣果の再登録や二重売却、ファイト後の固着、メニュー後の入力残留、例外を検査します。
初期セーブと乱数の固定はテストの再現条件に限定し、本番の判定や状態遷移へ直接注入しません。

昼夜360秒周期を複数回通し、昼→夜→昼、通常霧・濃霧・解消、メニュー停止と復帰、
保存時計の再読み込みを組み合わせます。既存の仮想時計は起動前に導入します。
長い `fastForward` は時計・環境の経過を検査し、釣りと船の多数フレーム更新には数えません。
釣り・移動には既存のdt上限があるため、必要なシミュレーション更新を別に実行します。

仮想時刻の複数周期通過は実時間15〜20分の連続負荷・端末発熱・OS割込みを保証しません。
実時間待機をCIへ追加せず、後述の実機受入で確認します。

## 描画リソース・メモリ

<!-- resource-results:start -->
基準は390×844、DPR 0.5・Renderer pixel ratio 0.5、SwiftShaderです。操作・リソース寿命の検査を
低backbuffer負荷で行い、実DPRの画質比較は4C-2Aの既存`mobile-performance.spec.js`を維持します。
船は(10, 13.6398413555)・heading 0、READYのFPSカメラは約(10, 2.15, 13.0398413555)、
各標本は同じ昼の位相・霧なしです。viewport/DPR/buffer/カメラ/船/光源方向/霧の一致をassertしてから
リソース数を比較します。全座標・quaternion・ヒープ生値はJSONに残します。

| 同条件の標本 | Calls | Triangles | Geometries | Textures | Programs | Drawing buffer | Pixel ratio | JS used heap |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |
| 初期（450秒） | 26 | 221,152 | 23 | 3 | 11 | 195×422 | 0.5 | 9.08 MiB |
| 初回捕獲・霧利用後（810秒） | 26 | 221,152 | 25 | 3 | 13 | 195×422 | 0.5 | 12.05 MiB |
| 2回後（2970秒） | 26 | 221,152 | 25 | 3 | 13 | 195×422 | 0.5 | 12.89 MiB |
| 3回後（3330秒） | 26 | 221,152 | 25 | 3 | 13 | 195×422 | 0.5 | 7.65 MiB |

初期→初回利用後のGeometry +2・Program +2は、最初の釣り・夜霧を通過して使われた既存リソースの保持です。
初回利用後→2回後→3回後は全描画項目が一致し、この有限反復では増加を検出しませんでした。
JS heapは自然GCを含む生標本で、GCを強制・統制していません。画像のdecoded cache・GPUメモリは未計測です。
3回とも同じ魚画像URLを再利用し、ページ再読み込み前は1 URL・1リクエスト、再読み込み後は同URLの
追加1リクエストでした。全魚種のdecoded cache容量をこの標本だけで保証しません。

全標本と再読み込み後のhealth確認でWebGL context loss 0、console.error/pageerror 0でした。
`after-reload`は新しいRendererと操船カメラなので、この表の同条件比較には含めません。
<!-- resource-results:end -->

描画リソースはThree.js既存の観測口をテスト側で使い、本番のデバッグAPIを追加しません。
同じ視点・環境へ戻した標本だけでcalls/trianglesを比較します。回転やカメラ移動によるcullingの差は
リークと判断しません。霧や釣り表示の初回利用で確保されるリソースはウォームアップ後の増加傾向と分けます。

ブラウザのJS heapはGPUメモリではありません。GCや測定時点の影響もあるため、単回の増減だけで
リークやGPU使用量を断定しません。実GPUメモリ・端末RAM・実機FPS・電池消費は取得できなければ
「未計測」とします。魚画像の再利用と、音声PCMの最大3本のキャッシュ（合計6,350,400 bytes）は
意図した保持です。繰り返し操作ごとの無制限な蓄積とは区別します。

## 音声の調査と残課題

過去のスマートフォンChrome・Braveで、ONにしても「操作後に再生できます」が継続した報告は、
現在の実機では未確認です。Phase 4B-2の改善や今回の自動検証だけで解決済みとしません。
再現・原因の証拠がない限り、推測による音声システムの書き換えは行いません。

既存の音声fixtureで初期OFF、ON切替、trustedなタッチ・クリック、resume成功・拒否・保留、再試行、
古いPromise結果、running/suspended/interrupted、停止理由の合成、保存ON再読み込みを検査します。
メニュー・visibilitychange・blur/focus・pagehide/pageshow、復帰後の新しい操作を扱い、
AudioContext・同時SourceNode・PCM生成回数を区別して確認します。
Fake AudioContextは制御経路、ネイティブChromiumのgraph/gainはブラウザ実装上の接続・出力を検査します。
どちらもスマートフォンのスピーカーから聞こえることを証明しません。

今回追加した音声ケースは、blur・非表示・pagehideにsuspended/interruptedを重ねた中断からの復帰を
4回繰り返します。復帰イベントだけではresumeせず、新しい実タップの再試行でrunningへ進むこと、
停止時のlive nodeが0、再開時がSourceNode 3個・gain 4個、Context 1個・PCM 3本であることを検査します。
停止済みの使い捨てSourceNodeの累計生成数と、同時に生存する数を区別します。
音声本体に原因が確定した新規不具合は確認しておらず、実装の修正は行っていません。

`audio-session.test.js`は保留要求の再試行・古いPromise・statechange優先・closed置換・dispose、
`audio.test.js`は停止理由の合成・PCM再利用・ノード解放・生成失敗とアタリ音の分離を検査します。
`audio-gain.spec.js`は4更新間隔×hold対応有無の8条件でネイティブOfflineAudioContextを使います。
実機の出力先や実時間の負荷を再現する検証ではありません。

実機で再現した場合は次をPMへ渡します。原因未確定の項目は「仮説」と明記します。

| 観測点 | 記録内容 |
| --- | --- |
| 端末・操作 | OS、ブラウザ版、URL/SHA、ON/再試行までの操作、縦横、再読み込み・アプリ切替の有無 |
| イベント | `isTrusted`、`navigator.userActivation.isActive`、pointer/touch/clickの順序。取得不能なら未取得 |
| Context | 初回生成時点、`resume()`要求回数、Promise成功/拒否/保留、`AudioContext.state`の推移 |
| 停止理由 | menu/hidden/blur/pageの残留、復帰イベントの有無 |
| Player | start/stop、同時source数、PCM再利用、context数。生涯生成数と同時稼働数を混同しない |
| 実出力 | 端末音量、消音・Bluetooth等の出力先、実際に聞こえたか、アタリ通知音が聞こえたか |
| 影響 | 無音中も釣りが続くか、何度目の再試行で回復したか、表示と実出力が一致するか |

表示が「再生中」でも実出力を保証しません。再生できないときに成功を保証する誤表示、再試行不能、
釣りの停止、無制限なcontext/source増加が再現した場合は未解決問題としてPMへ報告します。
ユーザーが最終的に実音を聴取し、再現条件・回復手順・受入可否をブラウザ別に記録します。

## 互換性と診断成果物

セーブv1、2スロットの世代・復元・保護、魚の捕獲履歴・保管・売却状態、所持金、装備、図鑑、実績を
既存仕様のまま扱います。音声設定はゲームセーブと独立です。既存の値やバランスは変更しません。
WebGL context loss時の安全停止と再読み込み案内も維持し、自動復旧の新機能を追加しません。

測定JSON・必要な比較画像・失敗診断は `test-results/` または `.ci/` に保存し、既存Actionsの
`browser-test-results`（14日保持）へ含めます。PRレビュー・実機受入が保持期限を超える場合は、
PMが必要な証拠を期限内に取得します。診断画像・生成音源・テスト用PCMをGitやPagesの`dist`へ混入させません。

## P4：PR #29の比較テスト修正

当初HEAD `334df5eae731e7671c485d094bb6ab13884d786f`の
[CI run 40167545640](https://github.com/tk0mygit/barb/actions/runs/40167545640)は、単体447件成功、
E2E184件中168件成功・16件失敗でした。継続プレイ・音声・保存を含む成功と、CI全体の失敗を区別します。
失敗16件はすべて`mobile-performance.spec.js`のmain側で、描画15条件とportrait FIGHT回転1条件が
旧上限1.75を期待し、最適化済みmainの実測1.5を拒否していました。さらにレポート生成にも旧改善率の前提が残っていました。

P4は`src/`、ゲーム仕様、倍率、画質、HUDの製品実装を変更しません。比較元は引き続き
`a22ce01531befa55230fb186579731b8a3b9aeb6`です。実際にarchiveするbase SHAから解像度moduleを読み、
source blob `175a5e75df1c7a48aa28c63785ca71d7835af32a`とmain内の接続を照合します。
PR側は実検証SHAのソースを使い、作業中の製品ソースがそのSHAに一致することも確認します。

既定の`regression`モードでは同じ測定条件の倍率/buffer/リソース数・HUD寸法/配置の一致を要求します。
ピクセル増加だけでなくPC解像度低下も検出し、HUDと主要操作領域・レティクルの非重複を維持します。
改善率0%を「20%改善した」と表示しません。4C-2Aの歴史的な約26.5%削減とHUD縮小は、
改善前SHAを明示した`historical-improvement`モードに20%以上削減・HUD面積縮小の条件を残しています。
詳細なモード指定と再現コマンドは[MOBILE_PERFORMANCE.md](MOBILE_PERFORMANCE.md#比較の再現と成果物)にあります。

<!-- p4-results:start -->
局所の修正コード検証SHAは`942f056abdda2cb9f4b6affb38f57078b7d88596`です。
この後のコミットは結果の文書追記のみで、実装・テストコードは同じです。
環境は上記と同じNode v24.19.0 / Chromium 154.0.8037.57 / SwiftShader、CPU割当2コアです。

| P4検証 | 結果 |
| --- | --- |
| `npm ci --cache /tmp/barb-4c2b-npm-cache` | 成功、依存関係変更なし |
| `npm test` | 465件成功、失敗/skip 0、14.36秒。比較目的/期待倍率/不正入力/負の検査18件を含む |
| `npm run build` | 成功、既存chunk-size警告のみ |
| 比較specの局所実行 | main/PR各29件、計58件成功、725.49秒（約12.1分）。skip/unexpected/flaky 0 |
| 当初失敗した16件 | CIログの名前と局所JSONを照合し、全16件成功 |
| 比較資料 | 描画25＋HUD9＝34組、HTML内68画像、各個別PNG/JSON、metadataと測定時間を保存 |
| 現在mainとの比較 | 34組とも描画ピクセル差0%、buffer/5種リソース数一致、HUD寸法/配置一致で合格 |
| 画像確認 | 34組すべてPNGのSHA-256が前後一致。portrait FIGHT画像も目視照合 |
| 実測データの負の検査 | mobile倍率1.5→1.75、PC倍率1.75→1、HUD高さ122→132の各入力をレポート判定が拒否 |
| 歴史的改善モードの単体検査 | 改善前SHA確認、20%以上削減・HUD縮小を維持。0%改善や違うbase SHAを拒否 |
| 継続プレイ/音声/保存の維持 | 当初HEADから製品`src/`と対応spec/fixtureに差分なし。当初CIの成功記録を参照し、新HEADの全件成功とは区別 |
| P4の他spec/全件E2E | ローカルでは未実行。新HEADのL2全件結果はPM確認待ち |

比較モードは`regression`、base SHAは`a22ce01531befa55230fb186579731b8a3b9aeb6`、
記録された測定HEAD/実検証SHAは上記`942f056…`です。新たなE2Eケース・仮想描画フレーム・sleep・
リトライ・タイムアウト延長は追加していません。CI全体の実行時間の増分は未計測です。
歴史的改善モードの全58件E2Eは今回再実行しておらず、4C-2Aの既存実測表と目的別単体検査を区別します。

P4の比較資料は`test-results/p4/mobile-comparison/comparison.html`と`.json`、
`comparison-metadata.json`、`main.json`、`pr.json`。16件の照合と画像hash確認は
`test-results/p4/comparison-validation.json`、負の検査は`test-results/p4/negative-checks.json`です。
診断画像をGit/Pagesへ含めず、従来の`browser-test-results`へ引き継ぎます。

```sh
npm ci --cache /tmp/barb-4c2b-npm-cache
npm test
npm run build
BARB_MOBILE_BASE_SHA=a22ce01531befa55230fb186579731b8a3b9aeb6 \
BARB_MOBILE_COMPARISON_MODE=regression \
BARB_MOBILE_OUTPUT=test-results/p4/mobile-comparison \
  npx playwright test tests/browser/mobile-performance.spec.js --reporter=line --output=test-results/p4/mobile-e2e
```
<!-- p4-results:end -->

通常PRでも従来の34組（描画25・HUD9）のJSON/HTML・68画像と実測時間を保存し、モード・base/HEAD/
実検証SHA・実装source blob・測定条件を併記します。出力先は`test-results/p4/`、CIでは従来どおり
`browser-test-results`です。元CIの失敗ログも保存します。新しいCIの完了待機や継続ポーリングはしません。
P3-B分類は変更せずL2全件E2EをActionsへ委任します。ローカル全件E2E、マージ、デプロイは行いません。
実機聴取・15〜20分受入、最新HEADのCIとマージ可否は引き続きPMの確認待ちです。

## スマートフォン実機テスト

ChromeとBraveでそれぞれ独立した15〜20分のセッションを行います。片方の成功を他方へ流用しません。
以下の記録欄とA〜Dをブラウザごとに複製して記入し、未実施はチェックせず「未確認」とします。
端末から聞こえる音、発熱、ブラウザバー・ノッチ、OSのアプリ切替は実機で確認します。

| 記録項目 | Chrome | Brave |
| --- | --- | --- |
| 判定 | 未確認 | 未確認 |
| 確認者・日時・タイムゾーン | 未記入 | 未記入 |
| 端末 / OS / ブラウザ完全版 | 未記入 | 未記入 |
| 公開URL / 最終main SHA / Pages run | 未記入 | 未記入 |
| 開始・終了時刻 / 実プレイ時間 | 未記入 | 未記入 |
| 画面寸法・向き・文字サイズ・表示倍率 | 未記入 | 未記入 |
| 音量・出力先・実音聴取 | 未記入 | 未記入 |
| FPS（方法・測定区間） | 未計測 | 未計測 |
| JS heap（方法・初期/最終） | 未計測 | 未計測 |
| GPUメモリ（別の測定がある場合のみ） | 未計測 | 未計測 |
| 電池開始/終了・充電・輝度等の条件 | 未計測 | 未計測 |
| 発熱・操作遅延の主観評価 | 未評価 | 未評価 |
| 不具合・再現手順・回復・証拠への参照 | 未記入 | 未記入 |

FPS・メモリ・電池値は取得できなければ未計測のままにします。発熱・操作感は主観評価と明記します。
電池の減少だけでアプリ単独の消費を断定せず、充電、画面輝度、通信、他アプリ等の条件を記録します。

### A. 起動・表示

- [ ] ページが正常に起動し、エラー表示やブラウザ停止がない。
- [ ] 湖・船・水面・魚画像の描画が正常。
- [ ] 昼夜、通常霧・濃霧・解消の表示が正常。
- [ ] 縦→横→縦の回転後も描画、HUD、操作欄、dialogが崩れない。
- [ ] 動作中の大きなちらつき・描画破綻がない。
- [ ] ブラウザバーの伸縮・ノッチ・セーフエリアで重要な文字やボタンが隠れない。

390×844、844×390、360×740、高さの小さい横画面は自動検証の代表CSS寸法です。
実機では実際の表示寸法とブラウザバーの状態を記録し、端末で作れない条件は未確認にします。

### B. 操作・釣り

- [ ] 操船ドラッグと解放・停船が正常で、意図せず動き続けない。
- [ ] 停船後のタップと釣りのFPS視点への移行が正常。
- [ ] ルアー選択、キャスト準備とキャンセル、キャスト・フリックが正常。
- [ ] アタリから1秒以内の新しい操作でアワセできる。
- [ ] ファイト中の長押し・解放が反映され、指を離すと入力が残らない。
- [ ] ファイトHUDが中央の視界を妨げず、操作ボタンに重ならない。
- [ ] テンションゲージ・数値・高低警告を読める。
- [ ] ファイト中の回転後もHUDと操作ボタンを使え、タッチが阻害されない。
- [ ] ランディング、釣果の保管・売却が正常で、履歴や通貨が二重加算されない。
- [ ] 図鑑・保管の縦スクロールと装備画面を使える。
- [ ] メニュー開閉後と釣果終了後に操作・操船へ戻れる。

### C. 継続プレイ

- [ ] 15〜20分程度、操船→釣り→釣果→図鑑/保管/装備→操船を繰り返し、重大な不具合がない。
- [ ] 操作遅延が顕著に悪化しない（主観評価を記録）。
- [ ] 極端な発熱・ブラウザ停止がない（発熱は主観評価を記録）。
- [ ] 昼→夜→昼を複数回通し、通常霧・濃霧・解消が同期している。遭遇しなかった状態は未確認。
- [ ] メニュー・図鑑・保管を繰り返し開閉しても使える。
- [ ] アプリ切替・画面非表示から戻ると入力が残らず操作でき、非操作時間が時計へ異常加算されない。
- [ ] 再読み込み後も捕獲履歴、保管魚、売却済み状態、所持金、装備、図鑑、実績が残る。
- [ ] 保存状態に異常がなく、再読み込み・復帰で釣果や実績が重複しない。

濃霧などが自然に出現しなかった場合、テスト合格のためにセーブやゲーム数値を書き換えません。
未確認を記録し、自動検証結果と合わせてPMが追加確認の要否を判断します。

### D. 音声

- [ ] 初回OFFを確認し、サウンド設定でONへ切り替えられる。
- [ ] ON後または有効な再試行後、実際のBGMを端末から聞ける。
- [ ] 音量変更が実際の聞こえ方へ反映される。
- [ ] メニュー中に停止し、閉じると再開する。
- [ ] アプリ切替・画面非表示から戻った後、必要な新しいタップ・再試行で再開できる。
- [ ] 中断後の再試行を繰り返し操作でき、操作待ちや開始処理中のまま固着しない。
- [ ] 再生できないときに誤った再生成功を保証せず、無音でも釣りは続く。
- [ ] 昼夜・霧に応じたBGM・自然音の切替を聞ける。遭遇しなかった条件は未確認。
- [ ] アタリ通知音を聞け、アワセ操作を妨げない。
- [ ] 音が重複して鳴る、復帰ごとに大きくなるなどの異常がない。

## 未確認事項とPhase 4C完了条件

PR提出時点で実機Chrome・Braveの15〜20分連続プレイ、実音聴取、実GPU・端末メモリ・電池、
物理ノッチ・OS割込み、Safari/WebKitは未確認です。自動テストによる仮想周期やFake AudioContextで
代替済みとしません。対象外ブラウザの未確認と、要求されたChrome/Brave受入の未完了を区別します。

Phase 4Cの完了には、少なくとも次の確認が必要です。

1. 最新HEADの`ci-required`が成功し、判定レベル・全件収集/実行・診断をPMが確認する。
2. 現在のmainとの統合可能性を確認し、ユーザーが4C-2Bをマージする。
3. マージ後の最終mainからビルド・Pages公開されたことを確認する。main pushのE2E省略は仕様として記録する。
4. その公開版でChrome・Braveそれぞれの実機受入と音声聴取結果を記録する。
5. 4C-0/1A/1B/2A/2B、計画外P1〜P3、未解決事項を通覧し、PMが完了または残課題付き保留を明示する。
6. 次のPM向け引き継ぎを確定し、Phase 4C全体の成功と引き継ぎをもって現PMチャットの業務を終了する。

## 次のPMへの引き継ぎ記録

以下は完了後にPMが確定する記録です。未確認のまま完了日・成功を記入しません。
Phase 5以降の実装は本工程に含めません。

| 工程 | 引き継ぐ証拠・確認事項 | 最終判定 |
| --- | --- | --- |
| 4C-0 魚画像対応基盤 | [PR #25](https://github.com/tk0mygit/barb/pull/25)、`d5005421f4520f5c728a61f3543829303221e4da`。画像fallback・素材交換境界、回帰結果 | PM確認待ち |
| 4C-1A 湖の景観改善 | [PR #26](https://github.com/tk0mygit/barb/pull/26)、`df2d10b17385352209a54ea44f73bc7d67198fcc`。景観比較・昼夜/霧・描画量の証拠 | PM確認待ち |
| 4C-1B 12魚種画像 | [PR #27](https://github.com/tk0mygit/barb/pull/27)、`d8cbbe8c9bbeace7345cab789ebe5b066270fa84`。画像検査・釣果/図鑑/保管、ライセンス・混入確認 | PM確認待ち |
| 4C-2A モバイル描画・HUD | [PR #28](https://github.com/tk0mygit/barb/pull/28)、`a22ce01531befa55230fb186579731b8a3b9aeb6`。解像度/HUD比較、回転・safe area、既存の未成功/未確認の追跡 | PM確認待ち |
| 4C-2B 最終安定化・実機受入 | 本PR/SHA、操作反復・資源測定・音声・保存、Chrome/Brave各実機記録 | PR提出後に確認 |
| 計画外P1〜P3 | 各PR/SHA・目的・結果、P3-B分類/`ci-required`/公開フロー、未解決事項 | PM確認待ち |

履歴で確認できる関連変更は、P1 [#21](https://github.com/tk0mygit/barb/pull/21)
（`43a2ba09b456966488ca8a2562847a80ed2b4554`）、音声修正
[#22](https://github.com/tk0mygit/barb/pull/22)（`fc5474cc609deb8c26d74203223614345b9851f1`）、
P3-A [#23](https://github.com/tk0mygit/barb/pull/23)（`c1a56143b526f3da26144957ad614bb0ac339576`）、
P3-B [#24](https://github.com/tk0mygit/barb/pull/24)（`51ab2258227d7565ed9cd969bebc5012f3e47912`）です。
各工程の受入結果とP2の対応範囲はPM記録で照合し、マージ済みという理由だけで実機合格にはしません。

引き継ぎ本文には次を残します。

- 最終main SHA、4C-2B PR URL/HEAD、マージ日時、検証した組合せと最新HEADの`ci-required` run URL。
- Pages URL、公開run/日時、公開元main SHA、実機で確認した版との一致。
- 自動テストの成功・失敗・中断・未実行、CI時間、`browser-test-results`の参照・取得期限。
- 同条件の描画リソース初期/最終、JS heapとGPUの区別、キャッシュの扱い、測定上の限界。
- Chrome/Brave別の実時間、端末・OS・版、操作/HUD/保存/実音結果、発熱・操作感の主観評価。
- 音声の既知報告の再現有無、再現時の観測・原因確定/仮説・回復手順・担当・次の判断。
- 未解決/未確認事項ごとの影響、受入の阻害有無、証拠と担当。未確認を解決済みにしない。
- Phase 4C全体の完了可否と根拠、現PM業務終了の記録、Phase 5以降は別途指示が必要なこと。
