# Sky-4R2: Aurora color and world light

2026-11-13発行のユーザーPM承認指示に基づく実装準備。既存Sky-4チャットと現在のモデル設定を継続。
基準は `50bc6ebcca09e50b90c3a30c5dc8613255d85c6a`、独立ブランチ
`feat/sky4r2-aurora-world-light`、独立PR 1本、L2。マージ・デプロイ・受入はPMが行う。

## 変更前の依存・影響行列

製品コード変更前に以下の直接/間接依存と全呼び出し元を確認した。

| 境界 | 直接変更の予定 | 間接差と保護・検証 |
| --- | --- | --- |
| Aurora | fragmentの色/alpha、既存updateが同じサンプルの色光を返す局所拡張 | roll/salt/.20、CLEAR、15秒fade、720秒wrap、頂点/4倍モーション・80m sphere・geometry・UUID不変 |
| lake | 通常環境から再計算した色光を既存Hemiへ適用、水へ同じサンプルを渡す | Hemi 1・Directional 2、sun shadow 1、月/空/霧の通常設定・位置/描画順は不変 |
| water | 既存materialの小さなuniformと方向性を持つ反射寄与 | geometry/mesh/material/pass/texture増0、元のnoise/法線・太陽/月spec・fog/tone mappingを維持 |
| day-night | 変更なし | 元パレットを変更せず、別の再利用targetへlit ambientを計算。非出現時は元RGB/強度を完全コピー |
| main→clock/time-skip→lake | 変更なし。通常初回/毎frameとも既存lake.update(time, boat, clock) | 18倍/10秒、操作ロック・pagehide回帰、保存/再開、blur/hidden/menu、普通のOFFプレイを維持 |
| 入力/カメラ/釣り/QTE/UI/音/保存/実績/売価 | 変更なし | src差分3ファイルの拘束、domain Unit、PC/touch smoke・SkyCheck・代表釣り/QTE/save |
| water.update呼び出し元 | lakeだけが4引数目を追加。従来3引数は寄与0を明示的に再設定 | light sample/配列/既存uniform objectを再利用し、GPU buffer変更/共有RNG消費0 |
| day-night観測fixture | 新しいversion付きlight/water実測、同一frameのMesh/ambient/water独立ON/OFFを追加 | 旧Mesh ON/OFFの下部60%差0はそのまま保持。世界照明の意図的差は別契約で検証 |
| assertEnvironmentと全呼び出し元 | 新モデルのambient期待値だけをsource由来で算出し、その色光自体も検査 | day-night、stars、night-fog、SkyCheck、menu、scenery、mobile、final-stability。通常環境の全assertionを保持 |
| Mobile/scenery capture→比較CLI | 専用Sky-4R2 transitionとliteral pins、water/normal環境sourceの独立replay | 両完全SHA・実/固定カメラ・clock履歴・shader/uniform・資源を照合。旧遷移を二重加算しない |
| ci-required/CLI | 既存await済み比較経路から新遷移へ到達 | 34組/68画像、元データ/画像hash、artifact ID/SHA、全収集/実行ID、非zero終了を維持 |
| 歴史的Sky-2/3/4/Motion原典 | source/pins・許可差分の変更なし | Sky-4 Unit fixtureのlake参照は作業tree依存を除き、初回導入の同じ正規blobへ固定する。過去原典は置換しない |
| 既存Motion画像spec | R2 source証明に結びついた分岐で色変更とmotion保護を分離 | 旧motion検証分岐・画像/資源閾値を保持。R2でも45/29m、fold/hem/係数、形状を厳密保護 |
| CI/workflow/selector/Playwright/依存/asset | 変更なし | workers/retry/timeout/DPR・テスト選択・画質を維持、L2全件判定はPM |

## 実装候補

エメラルド・シアン・紫を滑らかな折り目依存の重みで混ぜ、alphaとlinear RGBの両方で本体を明るくする。
波の速度や変形・層・深度/透明設定は変更しない。星/月を残す通常alpha合成を維持する。

Auroraの既存update内でclock/天候を一度だけサンプルし、同じ可視量から再利用するlight color/strength/directionを得る。
通常のday-nightパラメータを変異させず、再利用する別targetへHemiのsky/ground/intensityを計算する。
waterは同じサンプルをuniformへコピーする。既存noise/Fresnel/法線を再利用し、Aurora方角に沿う柔らかい帯へ限定する。
非出現時はHemiの元色/強度へ完全復帰し、水の追加uniformを0に戻す。追加Light/Geometry/Material/Texture/RT/shadow/pass/callは0。

## 検証・納品計画

- Unit: 非当選/昼/霧/fade端の厳密復帰、同一入力/繰り返しの不変性、FPS/巨大clock/巻戻し/720秒/30夜、SkyCheck18倍と停止/復元、RNG/保存非干渉。
- source負例: base/HEAD/merge親、shader/確率/fade/頂点・Light追加、observer/GPU資源/再upload、非出現差、画像/ID/hash欠損、CLI誤成功を拒否。旧遷移のUnitを存続。
- 実画面: 同じ通常当選保存/時計・船・native TPS/FPS・PC/縦横でA/B。Meshだけ、Hemiだけ、水だけ、合成を分離。色別面積/代表点/輝度分布と船/地形/水のmaskを元解像度PNGで示す。
- fade/非使用/18倍skip・再読込・pagehideと普通のOFFプレイを含む局所E2E。全Regular/Mobileをローカル必須化しない。
- PC高DPR/タッチ縦横の同条件同期p50/p95/標本分布、実submission・warm/cold・immutable GPU、gzip/80KiB・配信資産/通信を記録する。SwiftShaderを実機FPSへ換算しない。
- 最終同一ソースでUnit/Build/局所検証し、初回失敗・未実施/実機未確認をPRと静的HTML/PNG/JSONへ記載。公開資料は本タスクの通常仕様に限定する。

source逸脱・余分な資源/描画・有意な性能劣化・非使用時の画素差・未解決FAIL/timeout・必要な見た目を証明できない場合はSTOP。
push/PR提出後にCI監視・wait/poll/rerun/cancel、merge/deployは行わない。Sky-5は着手しない。

## 実装・局所検証の記録

製品差分は既存3ファイルだけ。Auroraのfragmentにエメラルド `[.05,.95,.25]`、
シアン `[.035,.80,1]`、紫 `[.68,.15,1]` を用い、alpha係数を
`.34 - layer*.06` から `.44 - layer*.08` へ調整した。
受入済みの速度係数、X45/Y29m、fold/hem、80mの境界球、720秒wrapは不変。

既存Aurora.updateが返す同じ再利用サンプルから、強度 `opacity*.14` と色・世界方向を計算する。
Hemiは通常環境から毎回再計算し、skyを強度、groundをその0.3倍で混色、intensityを強度の0.3倍だけ加算。
水面は既存normal/Fresnel/broadを再利用し、Aurora方向との整列度のsmoothstep(.86,.995)に限定して色を加える。
非出現時はHemiを元のRGB/強度へ完全コピーし、水の追加uniformを0へ戻す。
初期の広い水面反射案は表示水面の全域を変えたため、上記の方向帯へ絞った。製品の最終変更後に画像を再採取した。

### ソースとGPU契約

`sky4r2-source.js` / `sky4r2-pins.js` / `sky4r2-edits.js` が今回だけの遷移を定義する。
完全base/HEAD、merge両親とtree、製品3ファイルの正規base blob・レビュー済みhunkの逆変換、
変更するobserver/CLI/テストの最終blobを照合する。docs以外の変更集合も許可リストと完全一致させる。
旧Sky-2/3/4/Motionの原典・pins・許可差分は変更しない。

実カメラと固定カメラで、従来の星・流星・Auroraに加え、既存Hemiの実GPU色とwaterのuniform、
geometry/material/program/buffer ID・upload回数をsourceから独立再生する。
GPU資源・draw/trianglesはbaseと完全一致。新規Light/Geometry/Mesh/Material/Texture/RT/shadow pass/drawは0。
Auroraは2 Mesh、共有Geometry 1、Material 2、GPU Program 1、最大2 calls/3,200 triangles、
既存星・流星と同時最大4バッチを実測した。waterは従来の4 buffers、Auroraは3 buffersで各upload 1回を維持。

### 初回FAILと数値表現の是正

先行の代表38ケースは37 PASS / 1 FAIL。SkyCheckのmid-skip reloadで、今回追加したCPU方向監査が
同じ角 `4.086797918395793` のcosについて、Node `0.5855765001837758` と
Chromium `0.5855765001837759` の1 Float64 ULP差を検出した。
同じ入力を両エンジンで別途計算して根因を再現し、GPU Float32の両成分のbitsが
`[1062175899,1058400343]` と完全一致することを確認した。

新規監査の方向vec2だけを実uniformのFloat32表現で厳密照合し、raw Float64値も保存する。
実GPUへの値も完全一致を要求し、1 GPU ULP差を拒否する正負例を追加した。
epsilon、画像・RGB/alpha・形状・資源の許容幅は追加していない。既存SkyCheckテスト本体と製品コードの是正変更は0。
元のログ・screenshot・default-diagnostics・traceは `test-results/sky4r2/local-final/` に保存した。

追加負例の対象パスを事前監査で訂正した際のUnit中断ログ、初回npm ciのsandbox proxy EPERMも別名で保全。
npm ciは同じ通常ユーザー・sandbox外で成功し、lockfile/依存は不変。原因不明のリトライ・timeout延長はない。

### 局所結果

- `npm test`: 最終ソースで1,299 PASS / 0 FAIL。新規source契約6件、純粋照明/資源5件、旧遷移・保存・RNG・釣り/QTE等を含む。
- 新規R2 16ケースと既存SkyCheck再読込1ケース: 17 PASS。夜開始/終了のfade=0は最初の実描画を同一時計A/Bで元PNG完全一致。
- 既存代表25ケースと景観8組16撮影: 41 PASS。PC/短横タッチ、通常0/2/5/10秒・200ms時系列、fade全点、30夜、同時表示、context loss、QTE・釣り・保存・SkyCheck ON/OFFを含む。
- 景観8組は冷キャッシュ・native camera履歴を独立再生し、新遷移で比較PASS。34組/68画像の完全性・artifact/画像hash・ID・SHAとCLI/最終集約はUnit合成証跡でも維持。
- 最終ビルド、同じlocked依存による2基準gzip比較、`git diff --check`: PASS。R2 +713 bytes、Sky開始前から+7,334 bytes / 81,920 bytes。
- PC高DPR・タッチ縦横の実Mobile 3組6ケース: PASS。各側20標本、実GPU値・固定/実カメラ資源を独立再生。全58件/34実ペアの完了とは区別する。

50,000夜の正規source再生はbase/PRともCLEAR 19,825 / FOG 15,130 / DENSE_FOG 15,045、
CLEAR当選4,010（条件付き20.226986%、全夜8.02%）で完全一致。確率・salt・天候・時計の変更はない。

PC TPSの共通Aurora領域の表示Y平均は39.72→46.16、寄与平均は11.98→18.42。
PC FPSは27.91→35.81。全6視点で2～3色を識別し、元解像度mask・色別面積/代表点・輝度分布を記録した。
船/地形/水への寄与を各々分離し、追加の白飛び0。Moon明部・本体だけの下部60%寄与は0。
非当選/CLEAR以外/昼とfade=0の世界照明・元画像・GPU資源はbaseと完全一致。

### 証跡・未確認

`test-results/sky4r2/` に原本ログ・PNG・測定JSON・静的HTMLを保存。
最終レビューは `test-results/sky4r2/review-lite/index.html` と `test-results/sky4r2-review.zip`、
元解像度の完全版は `test-results/sky4r2/review/index.html` と `test-results/sky4r2-evidence.zip`。
各ZIPにファイルSHA256 manifest、base/実行HEAD、source blob、測定条件を含める。
先行/最終の負荷測定は別データセットとして保持し、成功した値だけを採用しない。

SwiftShader/CDP・固定/実カメラ2描画とobserverの影響を含む診断であり、実機FPSやGPU時間ではない。
L2のGitHub実CI全件、実Mobile全58件/34実ペア、実機の外観・操作・長時間性能は未確認で、PMの判定を要する。
局所PASSは正式受入ではない。マージ/デプロイはPMのみ。Sky-5は未着手。

### 測定境界とCPU負荷

finishのみの先行測定では約12msのwindowに続き約2frame分のwindowがあり、
PC p95が約85.8%増える試行もあった。これを製品退行・実機FPSの証明には使用しない。
同期readbackを後段に置いた初回診断はpresent後の空buffer（alpha 0）を読み、base/PR両方の6件がFAIL。
ログ・traceは `mobile-readback-output/` に保全した。新規診断の配置をnative実描画直後へ修正し、
同じopaque alpha 255 / GL error 0のassertionと、1 frameにつき1 fence serial増加を要求した。
製品のpreserveDrawingBufferはfalseのまま。1 ordinary warm frameの後、各20 windowで現frameの画素を同期読出しする。
描画数・DPR・画質・timeout/worker/retry、従来のassertionは変更しない。

修正後の120標本はすべて有効なRGBA・GL error 0・連続serial 2〜21で、先行の極端な短時間/倍時間パターンは解消。
各windowは固定/実カメラ2描画と4 bytes readback/CDPの費用を含む。以下は同じsourceによるA/B診断で、実機FPSではない。

| profile | wall p50 ms | wall p95 ms | renderer task p50 ms | renderer task p95 ms | task p95差 |
| --- | --- | --- | --- | --- | --- |
| PC high DPR | 2941.68→2872.17 | 3454.47→3291.59 | 2929.34→2865.59 | 3447.68→3287.22 | -4.65% |
| portrait | 860.09→814.93 | 982.30→973.58 | 854.24→810.00 | 946.69→966.25 | +2.07% |
| landscape | 1074.35→1099.17 | 1175.12→1276.17 | 1052.79→1095.78 | 1165.69→1270.72 | +9.01% |

横画面ではtask p50も+4.08%であり、コスト増を0とは報告しない。全標本・範囲・分布と先行2試行を別々に保存した。
同期後wall範囲はPC base2702.3〜3573.9 / PR2725.2〜3308.9ms、縦724.0〜988.9 / 731.4〜987.8、
横996.5〜1183.1 / 988.2〜1359.8。同じstartup requestは6→6、transfer 450952→451666 bytes、追加外部origin 0。
景観cold CLEARは34 calls / 278644 triangles / geometry22 / texture4 / program12、8条件すべて各資源差0。
warm比較は縦32 calls/278388 triangles、PC・横36 calls/278804 triangles、geometry32/texture4/program18でbase/PR完全一致。

最後の測定observer blob更新後の最終manifestで、Unit全1,299件と局所E2E57件がPASS。
同期付き実Mobile6件もPASSし、重複なし計63の局所E2Eを検証した。全件L2 CIとは区別する。
最終コードと提出用docsだけの差は、ファイルblobの一致とsource transitionで監査する。
