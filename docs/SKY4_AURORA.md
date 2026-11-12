# Sky-4 / PR-D: CLEAR夜のオーロラ

基準main: `9277dbef6d7a2ab39c9f257041d519384c704635`（Sky-3 / #81）。
実装・局所検証・独立PRまでが2026-11-12の承認範囲。正式受入、マージ、デプロイ、Sky-5は別決裁。
想定L2: 全Regular A/B/C、Mobile、ci-required。既存CIの選択・workers・retry・timeout・画質設定は維持する。

## 実装前の影響マップ

| 経路 | 直接変更 | 間接影響と検証 |
| --- | --- | --- |
| 時計・夜天候・抽選 | auroraの専用hash/時計sampleのみ新設 | 180/360秒、15秒fade、CLEAR条件、50,000夜と高位桁、保存時計の独立再生 |
| 入力・船・カメラ | なし | PC TPS/FPS・タッチ縦横・短横、旋回、XZ追従と世界方向固定 |
| 描画 | aurora.jsとlake.jsの生成/接続/update委譲だけ | 2層の実ピクセル、星/流星/月/地形/水/木との順序、cold/warm GPU・ID・buffer |
| 釣り・QTE・HUD・音声 | なし | 同一seedの乱数呼出し列・魚・BITE時刻・QTE・売却、既存PC/touchスモーク |
| 保存・実績 | なし | 同じ保存bytes、旧v1の既存移行、復元最初の描画。解除/通知/報酬は追加しない |
| E2E撮影 | 共通renderer observerとMobile/sceneryのaurora証跡 | 実renderBufferDirect、固定/実カメラを分離。34ペア/68画像は維持 |
| 比較CLI | Sky-4 source transitionと独立replay | 両完全SHAのgit show、専用blob固定、改竄/欠損/非zero exitの負例 |
| ci-required集約 | 既存のawait済み比較経路を利用、CI設定変更なし | 同じraw captureを独立再生し報告を再生成。artifact ID/hash/全テストIDの既存検査を維持 |

## 描画と資源

静的な曲面geometry 1個（80×10区画）、2 Mesh、層別ShaderMaterial 2個。同一shader source/definesでGPU programを1個共有する。
最大2 calls / 3,200 triangles、3 GPU buffers（位置10,692 / UV 7,128 / index 9,600 bytes）、texture追加0。
星+1、流星+1を合わせたSky Updateの最大追加は4 calls。
両面はforceSinglePass。depthTest=true / depthWrite=false / fog=false、renderOrder=-2。
opaque Sky/地形の後、renderOrder=-1の星・流星、通常の透明な月/水/木の前に描く。
船XZだけに追従し、角度・色・foldは夜番号から固定する。揺れは稼働時計秒の720秒wrapと整数周期だけを使う。
境界球は曲面に沿う中心とshaderの最大変位48mを含み、背後のカメラではculling可能。

当選率はCLEAR夜20%を維持する。天候や共有Math.randomへ書き戻さず、専用saltの十進hashが大きい夜番号の上位桁も保持する。
不正/非有限/不一致の時計はvalid=falseで明示的に不可視。元時計の1ns未満の境界規約を合わせる。
同期UUIDコンストラクタだけcryptoへ隔離し、各呼出しのfinallyで元のMath.randomを必ず復元する。
初めて実描画するまでGPU uploadは0。一度表示した後のキャッシュは保持し、再訪でbufferを更新しない。

## ソース拘束

Sky-4比較のbaseは上記Sky-3後mainに限る。許可する製品差分はaurora新設とlakeの厳密に逆転可能な3接続だけ。
Sky-2/Sky-3の過去の基準SHA・star/meteor blob・observerを引き継ぎ、二重計上しない。
`sky4-source-pins.js`は製品・新規replay helper・撮影observerの最終Git blobを固定する。
比較時は両SHAの時計/天候/factoryを別々に読んで再生し、可視性・全属性/色/形/材質・2層所有ID・shared program・実submissionを照合する。
許容する浮動小数点差は観測clock由来のauroraTime / auroraOpacityに限り1e-10、時刻はfade/phase/wrap境界を越えないことも要求する。
Mobileのcomplete-scene warmupと通常のcold履歴を区別し、coldは過去に実際に描画した層だけGPU初期化を認める。

## Sky-5観測判定インターフェース案（未実装）

将来の描画側候補は、frame sequence・clock elapsed・viewport/buffer・カメラpose・nightIndexと、
層別の実GPU submission、viewportで十分なalphaを持つ投影面積、depthによる非遮蔽面積、最終画像への寄与を証拠として渡す。
内部当選、mesh.visible、frustumだけは候補情報にすぎず解除証拠にしない。
前向き/背向き・短横画面のON/OFF差分とsubmissionをE2Eで確認し、完全遮蔽や極小alpha/面積は棄却する。
実装時には可視面積とalphaの閾値をレビュー画像に基づいて決め、GPU query等の非同期結果を元のframe IDへ結合する。
WebGLのsubmissionだけでは遮蔽や画素寄与を証明できないため、それ単独で解除しない。

ゲーム側候補は`{frameId, clockSeconds, nightIndex, submittedLayers, visibleAreaPixels, visibleAlpha,
contributingPixels, viewport, active, continuityToken}`。これは仕様案で、本PRにproduction APIや実績処理は追加しない。
同じnightIndex/連続frame/連続した実ゲーム時間で約1秒を要求し、menu・blur・hidden・非表示・fadeの透明近傍は加算しない。
reload、context loss、resizeでの判定条件喪失、時刻ジャンプ、連続性tokenの変更は累積をリセットする。
停止復帰は過去秒を加算せず、次の有効frameから再判定する。短横のviewport外や完全遮蔽は0秒。
旧セーブの既存移行・実績ID・保存機構を維持してSky-5で別途追加する。Sky-4は実績定義/通知/報酬/保存スキーマを変更しない。

## 検証記録

50,000夜: CLEAR 19,825夜中4,010当選（20.226986%）、FOG 15,130夜中3,030、DENSE_FOG 15,045夜中3,037。
全夜で実表示条件に該当する割合8.02%。通常の当選・前向き撮影用時計は専用hashから探索した夜52の真夜中18,990秒。
Unit、局所実E2E、合成比較、実Mobile選択ペア、未実行の全L2、gzip・GPU同期測定はPR本文で分離して報告する。
最初のsandbox内npm ciはプロキシ接続/ログ書込制約で失敗し、同じlockfileを接続可能な境界で実行した。
SwiftShaderの時間は同一環境A/Bの診断値であり、Android/実機FPSの推定に使用しない。
