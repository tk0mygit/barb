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
