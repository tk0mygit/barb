# 自然湖の景観（Phase 4C-1A）

## Phase 4.5 G-2.5：既存850本を保全した増量

基準mainは `89de7dd3ba9fdfb3bb736c9d23ab62e7fdfc6b02`（G-2）。着手時の未処理PRは0件。
固定1,100本（針葉843・広葉257）をPR候補とし、G-3でPC/Android実機の操作・長時間利用・
発熱を受入れる。ソフトウェアChromiumの結果で実機性能の最終承認は代行しない。

既存の幹ID 0–849、針葉0–649、広葉0–199の全Float32行列・色を、基準から抽出した
SHA-256で固定する。位置・接地Y・向き・スケール・種別・幹と冠の対応も保全する。
岩90個、全地形・山・岸・両樹冠のgeometry/UV、B画素・共有material・disposeの契約は維持する。
G-1の非平行移動成分の検査と、G-2の850本だけを対象とする帯/30°区画の検査も残す。

追加幹ID 850–1099はseed25071の独立PRNGを使い、種別は最大候補の270:80を均等に挟む固定順序のprefixで決める（追加針葉193・広葉57）。
追加冠は各樹種の旧prefixの後へ書き込む。seed71の既存消費順は岩まで変えない。
端末別の再抽選・本数変更・保存形式変更はない。

既存850本の配置後、同じ16mセルへ追加分を挿入する。根元3.8m以上、保守的な冠半径和の60%以上、
岸から冠半径+10m以上、岸から160m以内、冠を山裾半径385mより内側に保つ。
noiseの開口部を残し、近岸から中景を中心に埋める。ID由来の螺旋候補は最大384回。
追加分にbest fallbackはなく、安全な候補がなければ例外にする。全冠頂点が有限な地形面より上にあることを
配置時とテストで検査する。配置時の追加検査は既存の丸め済み地形頂点を再利用してnoise再計算を避ける。
公開height samplerの数値、湖岸・航行境界・3つの釣りポイントは保全する。

| 比較候補 | 針葉 / 広葉 | 景観triangles（静的） | 850本との差 | 樹木の行列・色bytes |
| --- | ---: | ---: | ---: | ---: |
| 850（G-2） | 650 / 200 | 196,312 | 0 | 119,000 |
| 1,000 | 766 / 234 | 228,712 | +32,400 | 140,000 |
| 1,100 | 843 / 257 | 250,312 | +54,000 | 154,000 |
| 1,200 | 920 / 280 | 271,912 | +75,600 | 168,000 |

中間内訳は同じ追加ID列のprefix。元の樹種比率に近く、最終候補の270/80追加とも整合する。
1本は幹20+冠196=216 triangles、頂点attributeは幹34+冠120=154頂点。
採用1,100本は景観triangles約27.5%増、頂点attribute参照の理論増分は38,500/描画pass。
これはvertex shader実行回数やGPUフレーム時間の実測ではない。追加インスタンスbufferはCPU側35,000 bytes、
GPU側にも35,000 bytes（合計約68.4KiB）。共有geometry/texture、renderer内部管理分は別とする。
幹/針葉/広葉の3 InstancedMesh、景観8geometry・7material・1共有B textureを維持する。
追加pass・shader・shadow・透過カード・毎フレーム配置処理はない。calls同値を性能同値と見なさない。

三角形予算は `196312 + 250 * 216 === 250312` と厳格な最大250,312を併記する。
旧 `BASELINE_TERRAIN_TRIANGLES * 1.15` は承認された54,000を差し引いた景観へ引き続き適用し、
無関係な増分を許さない。cold夜は31 calls / 275,444 triangles / 20 geometry / 4 textures / 10 programs、
霧は従来どおり+3 calls / +6,144 triangles / +1geometry / +1program。
景観静的trianglesと全シーンのrenderer.infoは別の値で、camera/culling/描画pass条件も記録する。

mobileの34組比較は、基準の完全SHA・双方のsrc tree/terrain/texture blob・lock/index/Vite設定を照合した
今回の移行だけに正確な+54,000 trianglesを認める。calls/geometries/textures/programsは完全一致。
画像比較にも同じ移行照合を使用し、camera/source再生・保存時計・船・viewportの照合は維持する。
未知source、無関係な+1、巨大増分、後続PR、historical-improvementへ例外を広げない。
旧G-1のtexture例外は変更しない。

`scripts/review-forest-density.mjs` は通常CIとは別の任意レビュー用。850本は基準SHAをarchive、
他候補は記録したHEADをarchiveして本数定数だけを置換する。全src/build入力blob、配置JSON、
12条件×4列の48 PNG、初回・継続計測と自己完結galleryを指定ディレクトリへ出す。
全画像の実カメラをarchiveしたsourceから再生し、同じ保存座標/向き/時計/viewport/DPRと照合する。
昼TPS/FPS、CLEAR夜/FOG/濃霧、DPR3タッチ縦横、近岸/遠景、3釣りポイントを含む。
候補間で既存850・岩・geometryの指紋も照合する。画像・大きなログ・生成reportはGitやdistに入れない。

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  node scripts/review-forest-density.mjs /workspace/artifacts/g2-5
```

Node単調時計のsetup→初回描画後ready、CDP TaskDuration、各条件3窓×6通常フレーム（仮想96ms/窓）を記録。
昼TPSの初回は各候補3標本、他条件は1標本。継続の分布は6フレーム平均の窓であり、実フレームp95や
実機FPSには換算しない。通信・自動化・ソフトウェアGPU待ち・ホスト負荷と計測境界の差を含む。
GPU timer queryが使えない場合、GPU時間は未測定と明記する。暫定FPS約5%/p95約10%の監視値だけで
自動合格にしない。初回ready・CPU生成時間・継続処理を分けて評価し、以後のゲーム処理追加に余力を残す。
1,200本は比較資料へ残す。実機で遅延が出た場合の固定減量候補は1,000本とし、比較資料をG-3へ渡す。

G-2.5の収集結果（Node24.19.0、Chromium154.0.8037.57、2 CPU、ANGLE/Vulkan SwiftShader）：
4候補とも12条件を取得し、未比較の本数候補はない。通常窓の投入/完了の揺れを確認したため、
昼TPS・濃霧・DPR3タッチ縦の3条件では前後に`gl.finish()`を挟む補助診断も実施した。
GPU timer queryは利用不可。以下は補助診断の外部時間で、GPU単独時間・実機FPS・個々のフレームp95ではない。

| 本数 | CPU生成cold / warm中央値 ms | ready中央値 / 範囲 ms | 昼TPS継続窓 p50 / p95 ms÷frame |
| --- | ---: | ---: | ---: |
| 850 | 47.9 / 13.2 | 1,798 / 1,786–1,841 | 406.2 / 482.9 |
| 1,000 | 152.1 / 57.0 | 2,107 / 1,626–2,588 | 434.4 / 715.9 |
| **1,100** | **104.1 / 76.5** | **1,900 / 1,693–2,178** | **477.8 / 544.9** |
| 1,200 | 125.1 / 95.2 | 2,241 / 1,752–2,976 | 478.9 / 777.6 |

CPU生成はcold各1回・warm各6回、元のG-2と同じ`floor((n-1)*p)`の中央値。
readyは新規context各3回、継続は各3回×3窓＝9個の6フレーム平均で、表はnearest-rankのp50/p95。
生標本と両側のCDP TaskDuration、heap、操船窓、全12条件の通常窓もJSONへ保存した。
補助診断の濃霧p50は850/1000/1100/1200順に466.7/523.8/508.1/523.3ms÷frame、
タッチ縦は284.9/199.4/254.0/355.3ms÷frame（各3窓）。時計・船・画面条件は候補間で一致する。
一部の操船窓は約1.6–955ms÷frameに散らばり、完了待ちを加えてもホスト/driver待ちの影響を分離できない。
単回の高速値も遅い値も性能保証には使わない。setup→readyは初回GPUアップロードを含むが、アップロード単独時間は未分離。

1,200本は配置・画像を通過したが、readyの中央値/遅い側と継続窓の尾に懸念が残るため一段下げた。
1,100本は1,200本に対し21,600 triangles（景観約7.9%）・各14,000 bytesのCPU/GPU instance buffer・
warm生成約19msを減らし、250本分の近岸/中景増量を残せる。昼TPS継続中央値は両者ほぼ同じで、
この削減が実機で必要十分とは断定しない。1,000本のreadyや遅い窓には一貫した改善がなく、
暫定監視値を自動合否に使わず、1,100本を固定PR候補、1,000本を実機での減量候補にした。

採用1,100本の最近傍距離は最小3.806m / p50 6.813m / p95 15.469m / 最大83.464m。
帯別は380/344/218/127/31本（0–40/40–90/90–140/140–190/190–250m）、
既存の遠い孤立木と自然な開口部は残る。1,200本の最近傍18m超も14本で、全ての空隙を消したとは扱わない。
画像の目視で空隙の減少と水際/奥行きの残存を確認し、接地・冠頂点・間隔・境界は数値で別検証した。
1,100本の実行candidateは94個のsrc/build入力blobすべてが採用commitと一致することを再照合し、
`selected-source-identity.json`に完全SHAとsrc treeを記録した。比較資料はCodex納品物の`gallery.html`、
`comparison.json`、各本数のplacement JSON、`synchronized/`。通常L2の8景観比較と34 mobile組はActionsへ委任する。

ローカル検証は`npm ci --cache /tmp/barb-npm-cache`、単体674件、build、および局所E2E計19件。
E2EはPC/touch smoke・昼夜/霧の停止再開・cold/3回キャストの7件、mobile選択8件（実測6比較組：
PC昼TPS・横FPS・縦濃霧・BITE・FIGHT・FIGHT回転）、景観day-FPS/縦のmain/PR計4件が成功。
mobileの34組全件と景観8条件全件はローカル未実施と区別し、Regular/MobileのL2全件をPR CIへ渡す。
初回の単体実行で見つかったsandbox内のGit起動制約と過去camera commit不足は環境を補って再検証した。
timeout/retry/fixture/CI分類の変更や失敗を隠す強制操作は追加していない。CI待機・手動起動・マージ・デプロイは行わない。

## Phase 4.5 G-2：同じ850本の森林配置

比較元はG-1マージ後のmain `4e336519664b2010bf45fd461d0c6ae68dae190b`。
針葉650本・広葉200本・幹850本・岩90個を維持し、変更する個体属性はX/Zと接地Yだけとする。
G-1の両樹冠のposition/normal/color/uv/index、共有Bの64²画素・material・disposeは不変。
景観196,312 triangles、8geometry・7material、幹と2樹冠の3 InstancedMeshも維持する。

`forest-placement.js`は既存の候補座標を起動時だけ変換する。元のseed71による候補採取・
棄却・サイズ・回転・色の乱数呼び出しはすべて残し、岩まで同じ系列を消費する。
位置変換は既存の角度分布を利用し、岸からの距離を非線形に配分する。
固定seed947/631の周期noiseで前縁と外縁を揺らし、岸の空きと奥の斜面の樹林を両立する。
中腹以遠は近くの既存群生へ最大48m寄せる。前縁への集中だけで生じた奥の孤立を抑えるため、
最初の配置案からこの局所修正を1回行った。全周を等密度の壁にはしない。
初期CPU計測を受け、群生の最近傍探索では軸方向の距離で遠い候補を先に除く。
選ばれる群生・全850座標・全geometry/instanceバッファが最適化前と一致することも確認する。

16mセルで隣接木を調べ、根元3.8m以上・樹冠半径和の60%以上の間隔を探す。
独立したID由来の螺旋探索は最大64候補で終了する。固定850本では分離した候補が得られ、
岸から樹冠半径+10m、山の最初の裾半径385mより内側に収める。
毎フレームの処理、LOD、透過板、追加の影・照明・描画passはない。

G-1とG-2を同じ方法で新規集計した根元XZの距離（m）：

| 指標 | G-1 | G-2 |
| --- | ---: | ---: |
| 最近傍 最小 | 0.398 | 3.857 |
| 最近傍 p50 | 7.249 | 7.167 |
| 最近傍 p95 | 16.882 | 15.610 |
| 最近傍 最大 | 31.933 | 83.464 |
| 最近傍2m未満の木 | 61 | 0 |
| 最近傍18m超の木 | 38 | 13 |

各p値は850個の最近傍距離を昇順に並べた`floor((850-1)*p)`番目。
G-0の過去のp95とは母集団・算出方法を混ぜない。最大値は悪化しており、すべての木の
孤立を解消したとは扱わない。数値の均質化を目的とせず、残る遠い孤立や空隙も画像で判断する。

| 岸からの帯（m） | G-1本数 | G-2本数 |
| --- | ---: | ---: |
| 0–40 | 221 | 310 |
| 40–90 | 264 | 246 |
| 90–140 | 202 | 139 |
| 140–190 | 163 | 124 |
| 190–250 | 0 | 31 |

30°区画別の本数・帯別密度と全座標はレビュー用raw JSONへ保存する。
`tests/terrain.test.js`は不変geometry・岩の全行列/色・B画素/共有/破棄のハッシュを保ち、
移動する木はID順の非平行移動成分とinstanceColorをG-1から抽出したSHA-256で固定する。
配置の決定性・有限値・ID対応、全850根元のraycast接地、全樹冠頂点の地形・岸・山裾境界、
隣接木の過剰な重なりと帯/区画統計を別の契約で検査する。
`shoreRadius()` / `terrainHeightAt()` / 航行境界・3釣りポイントの20m/1.5倍は変更しない。

比較は本番build、PC1000×700/DPR1、船(10,20)/向き0からの既存8条件を維持する。
追加の近岸・斜め・中腹・3釣りポイント近傍は、テスト内の正規操船とREADYの視線操作で撮影し、
操作列・実際の船/カメラ・時計・霧・viewport/DPRを前後照合する。本番に座標設定APIは追加しない。
PNG/HTML/raw/ログはソースやdistへ入れず、PR用納品物と既存Actions artifactへ出す。
G-0/G-1の古いPNGを確認済みとはせず、今回のG-1から新規取得した画像と比較する。

G-1後の資源比較は4texturesを基準に、calls/triangles/geometries/textures/programsすべて完全一致を要求する。
旧3→4texture例外や比較source/blob照合、CI分類/timeout/assertionは変更しない。
位置によるcullingと初回setup→ready、固定frame窓のNode/CDP時間・heapは別々に記録する。
SwiftShaderの外部時間を実機FPSへ換算しない。G-1で報告された初回時間の増加の原因は未分離のまま
追跡し、配置後の資源数の一致だけで性能不変とは判断しない。
共有環境変更としてL2全件E2EはPR CIへ委任し、PMのマージ前レビューとユーザー実機承認を待つ。
実機・性能の横断受入と最終mainの全件回帰は後続の別工程で実施する。

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
