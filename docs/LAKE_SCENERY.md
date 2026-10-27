# 自然湖の景観（Phase 4C-1A）

## Phase 4.5 G-1：採用Bの樹冠

針葉650本はG-1形状候補 `ba5d6f0c7db46ad7391fa988bb4e31b71a82ebf4` の形状と
v2 B `49fa7c9bf6578a18153e377f9b80eed67da497d5` の模様を保持する。
広葉200本はmain `6c92a1c6d004580144db72011bf5999fa5a2e651` の形状へUVだけを追加し、
同じB模様を適用する。配置・個体行列/色の乱数列・幹/地形/岩/山・航行/釣りポイントは変えない。
各冠120頂点/588 index/196三角形、景観196,312三角形・8geometryを維持する。

`src/world/conifer-texture.js` は採用Bだけを生成する。64² RGBA、固定座標noise、
sRGB、mipmap/LinearMipmapLinear、repeat3×4、anisotropy1。不透明の明度斑を既存の
vertexColor/instanceColorへ掛け、linear平均0.68をmaterial gain1/0.68で補う。
追加照明・normalMap・透過板・shader/pass・影はない。両樹種で1material/1mapを共有し、
material総数はmainと同じ7。mapはworld初期化で1回生成し、既存の重複を除くmaterial cleanupで
1回disposeする。CPU画素16,384bytes、RGBA8全mip概算21,844bytes、UV追加は両冠計1,920bytes。

1000×700/DPR1/船(10,20)/向き0/保存90秒の初回実測は
31 calls / 221,444 triangles / 20 geometries / **4 textures / 10 programs**。
旧mainよりtexture+1。共有により旧foliage programを置き換えるため、coniferだけのv2 Bで見られた
program+1は残らない。霧は従来どおり+3 calls/+6,144 triangles/+1geometry/+1program。
これはSwiftShaderの資源計測であり、実機FPS/発熱や性能不変の保証ではない。

モバイル比較の例外は旧mainの完全SHAと、レビュー済みのsrc tree・terrain/texture blob・
lock/index/Vite設定を照合できる今回の移行だけに限定する。texture3→4だけを要求し、
calls/triangles/geometries/programsは完全一致。未知のsource、変更済みbuild入力、
導入後の通常PRは従来の全資源完全一致へ戻り、historical-improvementには適用しない。
比較のsource metadataへruntime treeと関連blobを追加し、作業中sourceとGit再読込も検証する。
このため比較source helperの変更も必要になるが、共通fixture/CI workflowは変更しない。

ユーザーPMはBを選定済み。両樹種の近景/斜め/昼夜/霧/縦横の比較、初回・継続CPU診断と
残る実機確認をPR資料へ添付する。G-2配置、G-3実機、Phase4.5最終main全件受入は別途必要。

以下の4C-1A表は歴史的な改善記録で、G-1の新規計測と混同しない。

砂・草・樹木を落ち着いた黄緑から青緑でまとめ、遠景ほど青灰色へ寄せます。
既存の空・照明・FogExp2に同じ景観を通し、夕暮れや夜霧に固有の別景色へ切り替えません。
外部画像・モデル・フォントは追加せず、プロシージャル描画を維持しています。

## 変更内容

| 対象 | 変更前 | Phase 4C-1A |
| --- | --- | --- |
| 岸辺 | 岸からの距離で砂色と草色を補間、頂点単位の乱数明度 | 座標ベースの連続ノイズで遷移幅・土の斑・岩色を変え、高さに応じて色を調整。水際へ頂点を配分 |
| 森林 | 同じ樹冠850本、均一に近い密度 | 針葉樹650本・丸い樹冠200本。向き・縦横比・色・群生に決定的な差を付け、実際の地形三角形へ接地 |
| 山並み | 3層の周期的な山頂、各層は1枚の斜面 | 3層の連続した不規則な稜線。各層に斜面と重なる裾を設け、森林の奥へつなぐ |
| 水面 | 細かいノイズ法線と明るい反射色 | 穏やかな方向性のある波紋、広い濃淡、抑えた深部色。遠方の法線・細部を減衰 |

`src/world/scenery-noise.js`の連続ノイズと固定シードを起動時だけ使います。
地形・樹冠・山の周回継ぎ目は座標・色・法線を揃えます。
樹木は幹1組・樹冠2組のInstancedMeshで、2種類の樹冠はマテリアルを共有します。
毎フレームの樹木再生成、geometry／material／texture生成、追加の反射パスはありません。
水面のFresnel近似・太陽／月ハイライト・航跡・既存の霧合成順序を維持します。

## 既存仕様との関係

`shoreRadius()`、船の航行マージン・座標系、湖面の高さ、3か所の釣りポイントと20m判定は変更しません。
`terrainHeightAt()`は景観を生成するときの接地専用で、操船や釣りの判定には使用しません。
昼180秒・夜180秒の共有時計、CLEAR／FOG／DENSE_FOGの50／35／15%抽選、
通常霧30〜70%・濃霧95%・夜の前後12秒フェードを維持します。
保存時刻による初回描画、メニュー・非表示・フォーカス喪失中の停止も既存経路を使います。
セーブv1・2スロット、音響条件、魚種・ルアー・釣りのパラメータは変更しません。

## 画像と負荷の比較

比較元mainは`d5005421f4520f5c728a61f3543829303221e4da`です。
`tests/browser/lake-scenery.spec.js`は既存の`setup()`と`lightingProbe`で本番ビルドを観測します。
船(10,20)・向き0・deviceScaleFactor 1を固定し、昼TPS、昼FPS、夕暮れ、霧なし夜、通常霧夜、濃霧夜、
スマートフォン縦390×844・横844×390の8条件を記録します。PCは1000×700です。
FPSへの切り替えは通常のUIから行い、同じフレーム数だけ既存のカメラ補間を進めます。

ローカル比較では既存チェックアウトからmainを`git archive`で一時ディレクトリへ展開し、
別の`dist`とpreviewサーバーを使います。Git worktreeは追加しません。
依存関係は`npm ci`済みの同じ`node_modules`を参照します。リポジトリルートで実行してください。

```sh
npm ci
reference_dir=$(mktemp -d /tmp/barb-scenery-main.XXXXXX)
git archive --format=tar d5005421f4520f5c728a61f3543829303221e4da | tar -xf - -C "$reference_dir"
ln -s "$PWD/node_modules" "$reference_dir/node_modules"
npm --prefix "$reference_dir" run build
LAKE_SCENERY_SOURCE_DIR="$reference_dir" LAKE_SCENERY_PORT=4174 LAKE_SCENERY_OUTPUT_DIR=.ci/lake-main \
  npx playwright test --config tests/browser/lake-scenery.config.js --reporter=line
npm run build
LAKE_SCENERY_OUTPUT_DIR=.ci/lake-pr \
  npx playwright test --config tests/browser/lake-scenery.config.js --reporter=line
node scripts/compare-lake-scenery.mjs .ci/lake-main .ci/lake-pr .ci/lake-scenery-comparison.html
```

インストール済みChromiumを使う環境では、各Playwrightコマンドへ
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`など実際のパスを指定します。
専用configの既定値は現在のチェックアウト・port 4173です。main用は別ソース・port 4174へ向けます。
比較スクリプトは8条件すべての船位置・カメラ・時計・viewport等の一致と描画予算を検査し、
画像を埋め込んだ`.ci/lake-scenery-comparison.html`と全計測値の`.json`を生成します。
各ケースのPNGと`*-metrics.json`、`lake-scenery-gallery.html`、集約JSONも各出力先に残します。
本番APIへのデバッグ操作追加やゲーム座標の直接書き換えは行いません。

PRのGitHub Actionsでは既存のL2全件E2E内で同じspecを実行し、
`GITHUB_EVENT_PATH`の`pull_request.base.sha`を一時展開・ビルドします。
`lake-scenery-reference.js`がport 4174の専用previewを起動し、PRとbase各8条件を収集した後に停止・削除します。
変更前後の`lake-scenery-comparison.html`／`.json`とbaseビルドログは、既存の
`browser-test-results`成果物へ添付され、14日保持されます。CIのリスク分類・workflowは変更しません。
生成画像はGit管理・公開ゲームへ追加しません。

1000×700・船(10,20)・向き0の実測リソースは次のとおりです。

| 状態 | 指標 | main | Phase 4C-1A | 差分 |
| --- | --- | ---: | ---: | ---: |
| 昼／CLEAR夜 | Draw calls | 30 | 31 | +1 |
| 昼／CLEAR夜 | Triangles | 220,228 | 221,444 | +1,216（+0.55%） |
| 昼／CLEAR夜 | Geometries | 23 | 24 | +1 |
| 昼／CLEAR夜 | Textures | 3 | 3 | 0 |
| 昼／CLEAR夜 | Shader programs | 12 | 12 | 0 |
| FOG／DENSE_FOG夜 | Draw calls | 33 | 34 | +1 |
| FOG／DENSE_FOG夜 | Triangles | 226,372 | 227,588 | +1,216 |
| FOG／DENSE_FOG夜 | Geometries／Textures／Programs | 24／3／13 | 25／3／13 | +1／0／0 |

樹冠を2組に分けたためcallとgeometryが各1増えます。岸辺は7,680→6,400、
山は576→3,072 trianglesで、差引+1,216。樹木の分割数は増やしていません。
霧3層の差分・40 calls未満の既存上限・霧の画素差分検証を維持します。
最終ビルドでのソフトウェアChromium単回標本（ms、main→変更後）：

| 条件 | 初回setup→ready | 25フレームの実時間／frame | CDPタスク時間／frame |
| --- | ---: | ---: | ---: |
| 昼TPS | 2,446.4→2,564.8 | 560.0→618.8 | 558.85→617.96 |
| 昼FPS | 2,317.9→2,373.3 | 505.5→578.0 | 504.32→575.24 |
| 夕暮れ | 2,324.6→2,455.7 | 531.0→481.8 | 529.06→479.90 |
| CLEAR夜 | 2,638.9→2,352.7 | 568.0→581.4 | 586.06→579.96 |
| FOG夜 | 2,520.9→2,785.8 | 642.6→694.0 | 641.52→692.59 |
| DENSE_FOG夜 | 2,915.8→2,707.4 | 629.0→653.9 | 674.71→652.39 |
| 縦390×844 | 1,776.2→1,851.5 | 307.6→328.3 | 307.04→328.08 |
| 横844×390 | 2,053.6→2,142.1 | 439.6→431.1 | 438.19→430.04 |

この標本では継続描画の実時間が最大14.3%増加しています。水面のノイズ評価を再利用して
3回に抑えましたが（変更前2回）、法線・色の計算は増えます。GPU資源の予算内であっても
描画時間が同じになるとはみなさず、実機での負荷確認を残します。フレームの範囲とCDP取得の
範囲には通信分の差があり、単回の値にはばらつきがあります。全生データは比較JSONに残します。
main／変更後の画像収集は各8件成功し、座標・時計・カメラ・viewportの一致と予算を確認しました。
CIのbase展開・ビルド・preview起動／終了経路も局所2件で成功しています。
最終コードで単体テスト428件、`npm ci`・本番ビルド、関連E2E 25件が成功しました。
実行specは`day-night`（12件）、`night-fog`（9件）、`fishing-spots`（2件）、
`smoke-pc`・`smoke-touch`（各1件）です。初回描画、昼夜・霧の境界と停止／復元、
PC・タッチの操船／FPS／キャスト／巻き取り、全3ポイントへの航行、縦横・resize、
WebGL／consoleエラーと既存の霧画素・性能検証を確認しています。ローカル全件E2Eは未実行です。

```sh
npx playwright test tests/browser/day-night.spec.js tests/browser/night-fog.spec.js \
  tests/browser/fishing-spots.spec.js tests/browser/smoke-pc.spec.js tests/browser/smoke-touch.spec.js \
  --reporter=line --output=test-results/lake-related
```

初回時間はNodeの単調時計による`setup()`開始から初期描画・readyまで（時計fixtureの準備を含む）、継続描画は
同じ25フレームを進める外部実時間とCDP `TaskDuration`（rendererメインスレッドのタスク時間。待機を含み得る）を記録します。
共有時計に差し替えられたブラウザの`performance.now()`を実時間の計測に使いません。
自動操作の通信・描画待ちを含むソフトウェアChromiumの標本で、GPU処理時間や実機FPSとは区別します。
目標はcallsの増加+3以内・trianglesの増加15%以内で、霧3層の追加分
（+3 calls／+6,144 triangles／+1 geometry／+1 program）は従来どおり検証します。

## 検証範囲と引き継ぎ

`tests/terrain.test.js`で配置の決定性、有限値、形状・周回継ぎ目、根元と描画面の一致、
資源共有・三角形予算・航行範囲と釣りポイントの整合性を確認します。
共有描画の変更としてCI分類はL2です。ローカルでは関連specとPC・タッチスモークを実行し、
PRの最新HEADではPMが全件E2Eと比較画像を確認します。数値テストだけで景観を受入済みとしません。

スマートフォン実機・Safari／WebKitの画質、GPU負荷、長時間の発熱・操作感は未確認です。
画面回転、岸へ近づいたときの植生、水面のちらつき、夕暮れ・夜の識別性を実機でも確認してください。
Phase 4C-1Bでは12魚種の画像制作を別途扱い、この工程の景観比較条件・昼夜との色調整を引き継ぎます。
