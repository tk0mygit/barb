# スマートフォンの描画とファイトHUD（Phase 4C-2A）

## Phase 4.5 G-2.5 の森林増量

G-2 main `89de7dd3ba9fdfb3bb736c9d23ab62e7fdfc6b02` から固定1,100本へ増量する比較だけは、
双方の完全SHA・src tree/terrain/共有B texture blob・lock/index/Vite設定を照合し、
250本×216＝54,000 trianglesの正確な差分を要求します。calls/geometries/textures/programs、
解像度・HUD・camera/source・保存時計の既存契約は維持します。無関係な+1、巨大増分、
未知source、導入後のPR、historical-improvementへこの増分を持ち越しません。
旧G-1のtexture移行例外も拡張しません。

850/1,000/1,100/1,200本の4列画像・資源JSON・初回/継続窓・近傍距離は任意レビュー用
`scripts/review-forest-density.mjs` で別成果物へ保存します。内訳・固定予算・メモリ・実行条件は
[LAKE_SCENERY.md](LAKE_SCENERY.md) のG-2.5節を参照してください。行列/色のCPU・GPU bufferは
各35,000 bytes増えます。draw callsが同じでも頂点処理・ラスタライズは増えるため、性能同値とは扱いません。
SwiftShaderのNode/CDP時間は実機FPS/GPU時間と区別し、初回遅延と継続の分布を別に記録します。
G-3ではPC/Android実機の高DPR縦横、通常/濃霧、昼夜・操船/FPS・長時間のメモリ・発熱を確認し、
以後のゲーム処理追加への余力を優先します。遅延時の固定減量候補は1,000本です。1,200本も同条件の比較資料に残します。

以下は4C-2Aの歴史的な比較・検証記録です。

比較元は最新main `d8cbbe8c9bbeace7345cab789ebe5b066270fa84`。
4C-1Aの自然湖と4C-1Bの12魚種PNGを維持し、描画解像度とDOM配置を調整する工程です。
実機のFPS・発熱・操作感の受入とPhase 4C全体の終了判定は4C-2Bに残します。

## 解像度

変更前は全画面で `min(devicePixelRatio, 1.75)`。WebGL2、antialias有効、high-performance、
ACESFilmicToneMapping、PCFSoftShadowMap、太陽1024²は維持します。

`src/rendering/resolution.js` の純粋関数でCSS幅・高さ・DPR・主ポインターのcoarse判定から計算します。
coarseかつ短辺600 CSS px以下では上限1.5倍、75万ピクセル予算、原則1倍以上。
`min(DPR, 1.5, max(1, sqrt(750000 / width / height)))` で、DPR 0.5などを引き上げません。
通常のPCと広い画面は従来の1.75倍上限です。極端に面積の大きい細長画面では1倍の画質下限を
優先するため、予算は絶対的なメモリ上限ではありません。不正な寸法・DPRは有限の正値へ補正します。

初期化とresizeでだけ計算し、同じRendererの `setDrawingBufferSize` で寸法と倍率を一度に設定します。
寸法・倍率が同じなら再確保しません。カメラaspectと投影行列を更新し、メニュー停止中も同期描画します。
CanvasのCSS寸法、イベントのclient座標、カメラFOV、タッチ感度は変更しません。
毎フレームの解像度変更や品質段階の往復は導入しません。

<!-- measured-rendering -->
| 条件 | CSS viewport / DPR | 倍率 前→後 | Drawing buffer 前→後 | ピクセル 前→後 | 削減 |
| --- | --- | --- | --- | --- | ---: |
| スマホ縦 | 390×844 / 2 | 1.75→1.5 | 682×1477→585×1266 | 1,007,314→740,610 | 26.48% |
| スマホ横 | 844×390 / 2 | 1.75→1.5 | 1477×682→1266×585 | 1,007,314→740,610 | 26.48% |
| 小型スマホ | 360×740 / 3 | 1.75→1.5 | 630×1295→540×1110 | 815,850→599,400 | 26.53% |
| PC | 1280×800 / 1 | 1→1 | 1280×800→1280×800 | 1,024,000→1,024,000 | 0.00% |
| 高DPR PC | 1280×800 / 2 | 1.75→1.75 | 2240×1400→2240×1400 | 3,136,000→3,136,000 | 0.00% |

各画面の5景すべてで同じピクセル削減を確認。25組すべてでdraw calls・triangles・geometries・textures・programsが前後一致し、6フレームの計測窓でも増加しませんでした。
画角によるcullingで画面間のcalls／trianglesは変わります。回転ではgeometry／texture／program数の維持と、同じ画角へ戻したときのcalls／trianglesの一致を検査します。

スマホ縦の実測（前後同値）：

| 景 | Calls | Triangles | Geometries | Textures | Programs |
| --- | ---: | ---: | ---: | ---: | ---: |
| day-tps | 29 | 221,188 | 23 | 3 | 11 |
| day-fps | 26 | 221,152 | 23 | 3 | 11 |
| clear-night | 29 | 221,188 | 23 | 3 | 11 |
| fog-night | 32 | 227,332 | 24 | 3 | 12 |
| dense-night | 32 | 227,332 | 24 | 3 | 12 |

ソフトウェアChromium単回標本（ms、前→後）。各時間は通信・待機・ホスト負荷を含み、初回と継続の範囲は下記の定義に従います。基準収集の一部では局所検証も動いており、時間差を解像度変更だけの効果とみなしません。

| 条件 / 景 | 初回setup→ready | 継続 外部実時間 / frame | CDP TaskDuration / frame |
| --- | ---: | ---: | ---: |
| portrait-day-tps | 4822.5→3853.7 | 1101.6→417.9 | 1100.4→417.2 |
| portrait-day-fps | 5375.4→2981.7 | 4939.5→518.4 | 5620.0→626.8 |
| portrait-clear-night | 6890.3→3482.7 | 1463.6→670.3 | 1463.2→669.0 |
| portrait-fog-night | 11959.2→4792.8 | 2618.7→371.2 | 2617.3→866.2 |
| portrait-dense-night | 15203.8→8342.5 | 3544.4→1105.1 | 3550.8→1235.6 |
| landscape-day-tps | 13415.9→3699.8 | 2975.0→863.7 | 2975.7→863.6 |
| landscape-day-fps | 12606.3→5216.5 | 1807.4→827.7 | 2460.8→826.9 |
| landscape-clear-night | 6579.6→3482.0 | 2184.1→654.1 | 2183.4→972.3 |
| landscape-fog-night | 9901.0→4179.8 | 2710.1→668.4 | 2703.4→667.8 |
| landscape-dense-night | 10170.4→4673.4 | 1665.4→996.4 | 1888.7→995.9 |
| small-day-tps | 4089.9→2898.2 | 868.4→597.0 | 872.6→596.9 |
| small-day-fps | 4451.0→2753.1 | 1079.6→538.7 | 1078.5→537.7 |
| small-clear-night | 5127.7→3153.6 | 706.9→509.9 | 849.9→599.2 |
| small-fog-night | 4050.0→3157.0 | 645.5→867.4 | 993.2→866.1 |
| small-dense-night | 4045.7→3454.6 | 773.6→463.2 | 772.7→710.4 |
| pc-day-tps | 11625.2→3930.6 | 1370.4→1034.1 | 1368.7→1034.1 |
| pc-day-fps | 4796.7→3840.4 | 1129.9→967.5 | 1127.0→967.2 |
| pc-clear-night | 8531.5→3964.3 | 2015.9→803.9 | 2014.9→802.9 |
| pc-fog-night | 10406.2→4159.7 | 3676.3→380.0 | 3675.0→1106.8 |
| pc-dense-night | 9462.1→4080.6 | 2141.8→1103.5 | 2137.3→1103.1 |
| pc-hidpi-day-tps | 7978.3→6682.9 | 873.9→2498.5 | 872.2→2498.1 |
| pc-hidpi-day-fps | 8153.6→6502.2 | 561.0→1035.7 | 553.8→1035.0 |
| pc-hidpi-clear-night | 11436.3→6254.6 | 2681.2→2207.9 | 3931.1→2207.0 |
| pc-hidpi-fog-night | 16173.4→7505.4 | 3934.6→1353.3 | 3933.2→2681.9 |
| pc-hidpi-dense-night | 8460.1→7864.4 | 2924.6→2331.2 | 2923.4→2758.2 |

TaskDurationはJSを含むrendererメインスレッドのタスク時間で、純粋なJS実行時間やGPU時間ではありません。CDPと外部時計の窓は通信分の差があるため一致しません。全生データ・初回タスク時間は比較JSONに保存します。

高DPR PC・昼TPSの補足：他のブラウザ実行を止め、各ビルドを1ページずつ、連続した6フレーム×3窓で測定しました。初回の遅い標本を消さず、別標本として保存します。

| 6フレーム窓 | main 外部ms/frame | PR 外部ms/frame | main TaskDuration ms/frame | PR TaskDuration ms/frame |
| --- | ---: | ---: | ---: | ---: |
| 1 | 2707.5 | 2544.9 | 3115.3 | 2543.9 |
| 2 | 1723.0 | 2748.3 | 2643.2 | 2748.4 |
| 3 | 1854.5 | 1177.7 | 2722.3 | 2821.6 |

同じ3,136,000ピクセル・同じ描画量でも標本が変動します。これだけでPCの速度差を断定しません。CIでは同じPCケースの `pcSamples` に3窓を記録します。ローカル補足の生データは `.ci/mobile-pc-followup.json`。
PC昼TPSのDPR 1／2は前後PNGのSHA-256も一致しました。景観の画質比較と時間のばらつきを区別します。
<!-- /measured-rendering -->

削減対象は描画ピクセルです。景観の三角形、ドローコール、影・霧のパスは変えません。
水面シェーダー・アンチエイリアス・影・InstancedMesh・魚画像の追加最適化は行っていません。
解像度調整だけで指定スマートフォン条件の約20%以上の削減を満たし、画像比較を行います。

## ON THE LINE

従来は左側の縦型パネルが水面・対象付近を覆い、横画面では下端からはみ出すことがありました。
モバイルでは装飾見出しを省き、状態／残距離、横長テンションゲージと数値／警告、環境情報の順に整理します。
環境情報はFIGHT中も参照できます。READYは状態と時間帯を同じ行にし、BITEは強い背景・枠と
「今すぐタップ」、操作案内の「1秒以内」を維持します。通常の文字12px以上、状態16px、警告14px、BITE18px。

縦画面は操作欄の直上、横画面は左下、ボタン群は右下。HUDを操作欄と同じCSS gridへ置き、
文字の折り返しに応じて空間を分配します。独立した固定bottom値でボタンへ重ねません。
PCでは従来の左上配置を維持します。色の変更だけでなく形状・位置・情報の順序を変えています。

`meter#line-tension` の意味・0〜1の値・しきい値は維持。数値と警告文も同じ値から更新します。
`data-level` は配色だけに利用し、判定・ファイト時間・入力に接続しません。
ゲージに暗いトラックと枠を設け、低／高テンションでは色と既存の警告文で伝えます。
`role=status` はフェーズ更新に維持し、ゲージ数値と警告に毎フレームのlive通知を追加しません。
アニメーションを追加せず、既存のprefers-reduced-motion設定を尊重します。

<!-- measured-hud -->
| FIGHT条件 / 画像ID | 矩形 前→後（CSS px） | 占有率 前→後 | 面積削減 |
| --- | --- | --- | ---: |
| `pc-fight` | (42.0,200.0) 280×241→(42.0,200.0) 280×241 | 6.59%→6.59% | 0.0% |
| `portrait-fight` | (22.0,177.2) 260×226→(22.0,611.0) 346×122 | 17.85%→12.82% | 28.2% |
| `landscape-fight` | (22.0,100.0) 230×221→(22.0,252.0) 320×122 | 15.44%→11.86% | 23.2% |
| `small-fight` | (22.0,155.4) 260×226→(22.0,507.0) 316×122 | 22.06%→14.47% | 34.4% |
| `rotated-fight` | (22.0,100.0) 230×221→(22.0,252.0) 320×122 | 15.44%→11.86% | 23.2% |

前後画像はActions診断成果物の `mobile-comparison/comparison.html` 内の同名見出しにあります。
PC・縦・横・小型のFIGHT、縦・横のBITE、回転後のFIGHTを含む9組を収集します。個別画像名は `main-<画像ID>.png` / `pr-<画像ID>.png`。
エージェントが比較画像で、中央の水面・ルアー・レティクルの視界改善と、ゲージ・警告の可読性を確認しました。数値だけで最終受入とはしません。
<!-- /measured-hud -->

占有率は矩形面積 / viewport面積 ×100。遮蔽の目安であり、視界品質の単独評価ではありません。
自動検査はレティクル12px、表示ボタン・masthead・表示通知8pxの余白とviewport内への収まりを確認します。
HUDの `pointer-events:none` を維持し、HUD内のネイティブ長押しで実際にテンションが上がることも確認します。
透明な操作ブロック・新しい必須操作は追加しません。

## 回転・セーフエリア・互換性

上下左右のenv(safe-area-inset-*)をCSS変数に集約し、masthead、操作欄、釣果・コレクションdialogに適用します。
ネイティブdialogはsafe area内で高さを制限し、既存の縦スクロールを維持します。
390×844、844×390、360×740に加え、740×360と640×320、25%文字拡大、縮小DPRを検査します。
ノッチ相当の44px／34px／21pxはCSS変数で模擬します。実機のブラウザchromeや物理ノッチの検証ではありません。

釣りの状態管理・キャスト・フリック・長押し・アワセ・テンション計算、船・釣りポイント、魚種・取引・装備・実績、
共有時計・夜霧・音声条件、セーブv1／2スロット／旧セーブ互換は変更しません。
delta上限0.25秒と船の0.05秒サブステップ、メニュー／非表示／blur時停止、復帰時刻リセット、
キャンセル／capture解放、離脱時保存、保存された夜霧からの初回描画、context lost時停止を維持します。

## 比較の再現と成果物

`mobile-performance.spec.js` は通常のL2全件E2Eで収集されます。PRでは既存のbaseビルド機構を再利用し、
PR base SHAをgit archiveで一時展開、同じlock済み依存関係でビルドし、port 4174で起動します。
worktreeは追加せず、終了時に一時ソースとサーバーを削除します。分類・必須チェック・workflowは変更しません。

通常PRの既定モードは`regression`です。現在のmainはすでに4C-2Aを含むため、毎回20%の削減や
HUDの縮小を要求しません。同条件の倍率・buffer寸法・ピクセル数・5種のリソース数とHUD寸法/配置を
厳密に比較し、ピクセル増加、PC画質低下、HUDの拡大/移動/重なりを拒否します。改善率0%は同値の結果です。
両側のviewport/DPR・時計・船・カメラ・霧の一致を保ち、ボタン/レティクルとの非重複も検査します。

G-1の共有B樹冠map導入だけは、旧main完全SHA・両側のレビュー済みsrc tree/terrain/texture blobと
lock/index/Vite設定を照合し、texture3→4の正確な増分を検証します。programを含む他資源は完全一致。
未知sourceや将来PRへ+1枠を持ち越さず、導入後同士は全資源完全一致です。source metadataとGit再照合を
維持し、historical-improvementにはこの移行を適用しません。実装と所有関係は `LAKE_SCENERY.md` を参照。

倍率の期待値は`main`というラベルから推測せず、`scripts/lib/mobile-comparison-source.js`で実際に
archiveするSHAの`src/main.js`と解像度moduleを読み取ります。参照したsource blobを記録し、PRの作業中
ソースも記録SHAと一致することを確認します。旧倍率は、下記の検証済み改善前SHAにだけ対応します。
未知の実装を旧1.75倍と仮定しません。縦/横/小型1.5、PC 1、高DPR PC 1.75、回転後buffer/aspect、
低DPR/不正DPRは単体・E2Eで引き続き検査します。

この文書の前後表・約26.5%削減とHUD面積縮小は、4C-2Aの歴史的な改善証拠として維持します。
`historical-improvement`を明示し、改善前`d8cbbe8c9bbeace7345cab789ebe5b066270fa84`を指定した場合だけ、
従来の20%以上削減・モバイルFIGHT HUD縮小を要求します。通常PRの回帰比較へ自動適用しません。

船(10,20)・向き0、保存時計、viewport、DPR、カメラ補間フレーム数、テスト内乱数を固定します。
5画面条件 × 昼TPS／昼FPS／CLEAR夜／FOG夜／DENSE_FOG夜の25条件を比較します。
初回はNode単調時計によるsetup開始→初回描画を経たready、継続は通常6フレーム（仮想96ms）の外部実時間、
JSタスクはCDP Performance.TaskDurationの差分です。Clockに置き換わるブラウザperformance.nowを実時間には使いません。
ソフトウェアChromium／SwiftShaderの単回標本で、通信・待機・ホスト負荷を含み、実機FPSやGPU時間を示しません。

FIGHT／BITEは通常のキャスト→待機→新しいタップで再現します。本番状態や判定への直接注入はしません。
PC・縦・横・小型の両フェーズとFIGHT中の回転画像、DOMRect・ゲージ寸法・占有率・renderer.infoを保存します。
高／低テンションは通常の長押し・解放で作ります。操作・回転・停止・リソース安定性は別の
`mobile-layout.spec.js` でも低DPRで検証します。

Actionsの `browser-test-results` 内 `mobile-comparison/comparison.html` と `.json` が全比較資料です。
HTMLへ前後PNGを埋め込み、個別PNGと測定JSON、main.json／pr.json、各テストの添付も保存します。
34組（描画25・HUD9）と68画像を維持します。`comparison-metadata.json`とHTML/比較JSONにモード、
base/PR HEAD/実検証SHA、実装のsource blob、viewport/DPR/時計/サンプル条件を記録します。
比較JSONは`{ metadata, rows }`形式、main.json/pr.jsonは従来のcapture配列にprovenanceを追加した形式です。
既存の診断成果物の14日保持に従い、画像・生成レポートをGitやdistへ混入させません。
ローカルは次のように実行します（比較元は取得済みコミット）。

```sh
npm ci --cache /tmp/barb-npm-cache
npm test
npm run build
# 通常PRの回帰比較（この修正時点の最新main。実行時は対象base SHAを指定）
BARB_MOBILE_BASE_SHA=a22ce01531befa55230fb186579731b8a3b9aeb6 \
  npx playwright test tests/browser/mobile-performance.spec.js --reporter=line --output=test-results/mobile-regression
# 歴史的な4C-2A改善比較
BARB_MOBILE_BASE_SHA=d8cbbe8c9bbeace7345cab789ebe5b066270fa84 \
BARB_MOBILE_COMPARISON_MODE=historical-improvement \
  npx playwright test tests/browser/mobile-performance.spec.js --reporter=line --output=test-results/mobile-review
npx playwright test tests/browser/mobile-layout.spec.js --reporter=line --output=test-results/mobile-layout
```

既存Chromiumを使う場合はPLAYWRIGHT_CHROMIUM_EXECUTABLE_PATHに実際のパスを指定します。
変更前後を別々に収集する場合はBARB_MOBILE_TARGET=main／prと別のBARB_MOBILE_OUTPUTを指定し、
`node scripts/compare-mobile-performance.mjs <main.json> <pr.json> <比較.html>` で統合します。
provenanceのない旧captureを再統合する場合は、後ろに`historical-improvement <改善前の完全SHA> <測定HEADの完全SHA>`を
明示します。SHAはGitから再照合し、モードを省略して旧データを改善比較として成功扱いにはしません。

## 検証結果・4C-2Bへの引き継ぎ

<!-- validation -->
環境：Node v24.19.0、Chromium 154.0.8037.57、SwiftShader、CPU割当2コア。実機未確認。

| 検証 | 結果 |
| --- | --- |
| npm ci（/tmpキャッシュ） | 成功、依存関係・lockfile変更なし |
| npm test | 447件成功 |
| npm run build | 成功、既存のThree.js chunkサイズ警告あり |
| 描画／HUD比較 | main 29件、PR 29件成功。34組の座標・時計・カメラ・描画量一致検査も成功 |
| 高DPR PCの追加3窓 | main／PR各1件成功。上表の全標本を保存 |
| 専用画面適応 | 1件成功。safe area、25%文字拡大、短い横画面、メニュー／FIGHT／釣果回転、blur、capture解放、時計、実WebGL context lossを含む |
| 既存の局所E2E（32件選択） | 28件成功、4件未成功。ローカル全件E2Eは未実行 |

既存specの局所範囲はsmoke-pc／smoke-touch、game、fishing、day-night、night-fog、lake-scenery、
fish-assets、save-data、fish-sales、equipment-ui、audioです。32件を収集し、最初の6件成功、
独立した26件実行で21件成功、固定URL修正後のモバイルgame 1件成功を確認しました。
PC・タッチの一連の釣り、BITE／FIGHT／釣果・保管、3画面の12 PNG、昼夜・霧の停止と初回保存復元、
PC／タッチスモーク、回転、装備、一括売却、音声の選択ケースが成功しています。

未成功4件（同じ4件が変更前mainの単独実行でも失敗）：

| 既存ケース | PR側の停止箇所 | main照合 |
| --- | --- | --- |
| day-night: night sailing with mouse | 視点・月の表示検査後の画像取得中、120秒超過 | 同じ120秒超過（巻き取り検査後） |
| fishing: mouse blur/lost capture | 15秒のpoll内でBITEまで進まずLURE。30更新＝7.5秒のゲーム時間のみ進行 | 同じBITE待ちのpoll制限でLURE |
| game: desktop renders/sails/returns | ネイティブ視点ドラッグ中、120秒超過 | 同じ120秒超過 |
| night-fog: operable at 1000×700 | 画像取得後のキャストボタン検査中、120秒超過 | 同じ120秒超過 |

この環境でmain側にも再現したことは、PRのCI成功を意味しません。4件を成功扱いにせず、
最新HEADのActions全件結果が必要です。テストの削除・assertion緩和・タイムアウト延長・固定sleep増加・
無条件リトライはしていません。初回の並列ブラウザ実行も遅延したため停止し、成功・失敗・中断・未実行を
区別して `test-results/mobile-regression/` と `mobile-regression-isolated/` に保存しました。
main照合は `mobile-native-baseline/`。同じ遅いケースをさらに反復して合格扱いにはしません。

専用ポートの検証でgameのモバイル1件が固定4173 URLへ接続して失敗したため、他ケースと同じ
baseURL参照へ修正しました。通常CIの接続先は変わらず、全assertionを維持して再検証は成功しています。
新規配置検査で見つかったREADY文字拡大時の近接と横画面left:autoのsafe area逸脱はCSS側で修正し、
最終専用検証で成功しました。最初の試作は旧distを参照していたため比較対象には採用せず、診断を保持しました。
画像の目視確認・数値検査はエージェントによるもので、実機の視認性・操作感の最終受入は4C-2Bへ引き継ぎます。
<!-- /validation -->

CI分類は共有描画・CSS・新規E2Eを含むL2。ローカルの--listでは23 spec・145件を収集しました。PRのCIではbase側の比較ケースも加わるため、実際の収集・実行件数はCI記録で確認します。全件E2EはActionsへ委任します。
Codexはローカル全件E2E、CI完了待機・継続監視、マージ・デプロイを行いません。
PMは最新HEADのci-required、実際のL2全件収集／実行結果、比較資料、最新mainとの統合可能性を確認します。

4C-2BではスマートフォンChrome／Braveで縦横のFIGHT・BITE・ゲージ・文字拡大・ブラウザバーと回転、
長時間釣り・メニュー・釣果・売却・保管・装備・音声再試行、FPS・発熱・メモリ・バッテリーを確認してください。
Safari／WebKit、実GPU、端末の文字拡大は未確認です。異なるOSや高DPRの見え方を今回のエミュレーションだけで合格としません。
音声の「操作後に再生できます」が継続する報告は別の残課題です。本工程では再生条件を変更せず、実機で解決したとは判断しません。
4C-0／1A／1Bに続く本PRのマージ・4C-2Bの実機確認を経て、PMがPhase 4C全体の完了状況、
計画外P1〜P3、未解決問題、最終main SHA・デプロイ状態をまとめ、Phase 5以降の別PMへ引き継ぎます。
