# Phase Sky-5: Celestial Observation Achievements

## 着手と権限

- 新規Codexチャット／独立ブランチ `codex/sky5-celestial-achievements`。推奨はCodex・高思考。
- 指定main、fetch後のorigin/main、開始HEADはいずれも `65021907bf06f5a0f765af9ea18dc5f91d43289b`。作業ツリーはクリーン。
- ユーザーPM承認は実装、局所検証、コミット、push、単一PR提出まで。URL報告後に終了する。
- **L2**。共通描画、ライフサイクル、実績保存を横断する。CI待機・監視・再実行、mainへのpush、マージ、デプロイは対象外。

## 実装前の変更影響行列

| 領域／依存経路 | 直接変更 | 間接的な観測差／保護と検証 |
| --- | --- | --- |
| ゲーム状態・実績 | `game/achievements.js` に末尾2件と種類限定の記録API | 旧17定義・順番・閾値・日時を維持。collectionの再評価では観測解除しない。購読形式・通知キューを維持 |
| 時計・確率・SkyCheck | 時計・抽選・time-skipは変更しない | 観測は単調なrAF時刻の差のみ。同一night／slot、初回基準、長いgap切断、スキップ終了フレームも非算入 |
| 入力・ライフサイクル | mainの既存中断経路から観測だけをreset | blur/hidden/pagehide/menu/dialog/resize/context-loss。pagehideラッチを既存OFFゲームループへ追加しない。native touch復帰を既存specで検証 |
| カメラ・通常描画 | renderingに独立した観測器。lakeから既存3Meshへの読み取り参照 | 通常renderの成功と当該Meshの実submitを両方確認。初回・resize描画は計測しない。カメラ操作・shader・資源・描画順を維持 |
| 前景遮蔽 | 初期化時に静的前景の保守的な境界索引を構築 | 山／岸は三角形境界、樹木／岩はinstance境界。小さな発光パッチへの視線束を確認。動的な船・竿・月も保守的境界で確認。GPU readbackや追加passなし |
| HUD／DOM | achievements-viewに観測0/1進捗 | 未解除名は「？？？」。既存noticeの5秒、入力透過、scroll/focus、日時を維持。通常横／短縦を検証 |
| 保存・復元 | achievements契約6とsave-dataの合法な契約5→6移行 | 外V3/revision3、collection schema、2キー、世代、autosave周期、settingsを維持。旧版完全検証、wire版保持、load無書換え、未来保護・競合を検証 |
| 通知→autosave | 既存実績subscribeへ同形式の解除配列 | 観測解除もdirtyと250msのevent save対象。履歴再通知・重複解除なし。新キー・秒数の保存なし |
| E2E撮影・fixture | 実績件数追従、通常保存時計からの新規観測spec | 実draw、視野・最低時間・中断・skip復帰と保存を確認。既存lightingProbeは本番判定に使わない |
| Sky-2/3/4/R2 replay・画像比較 | 既存比較器・pin・原典・閾値は変更しない予定 | Aurora/Meteor/水/カメラのsourceは維持。34組／68画像、資源・HUD・RNGの既存検証は維持。Unitの比較器拒否ケースを含める |
| CI集約→CLI／workflow | 変更なし | 新規specもL2の全inventory収集へ入る。既存ci-requiredの拒否、partition、source→capture→比較CLI→最終ゲートをUnitで検証。GitHub実結果は未確認と記載 |

### 局所検証で判明した比較依存への設計追記（比較実装前）

R2のE2EはbeforeAllで、R2導入時の3ファイルだけのdiffを現在HEADへ要求していた。
Sky-5の追加領域をこの歴史的証明へ混ぜることはしない。既存のR2証明・manifestを維持し、
基準main `6502190…` のR2証明を独立して再検証する。その上でSky-5の本番source tree
`4134216b8067fbbfce7ff44ea25587975d8e7c35` だけを対象に、lakeの凍結参照追加を
原文へ逆変換し、他の光学・カメラ・時計・抽選・build入力の完全一致を要求する。
未知tree、変更したshader/資源/描画/時計は拒否する。

| 経路 | 必要な追加 | 維持する条件 |
| --- | --- | --- |
| 生source→R2 E2E撮影 | Sky-5専用の光学保存証明を既存R2証明の外側へ追加 | R2原典50bc…と6502190…の完全な既存証明、同じ画質・GPU・native入力assertion |
| raw Mobile→比較CLI | 同じSky-5証明と星・Meteor・Aurora・世界光のsource replay | 34組／68画像、両カメラ、資源完全一致。追加の画像・CPU状態・GPU許容差なし |
| 最終ゲート | 既存の共通比較関数から同じ非同期証明を再計算 | ci-summary自体・workflow・選択規則は変更しない。改竄／欠損／CLI nonzeroをUnitで確認 |

## 局所設計（実装前）

描画層は通常の `renderer.render(scene, camera)` を囲み、開始時にsubmitラッチを空にする。
既存MeshのonBeforeRender/onAfterRenderを委譲し、その間の実draw call増加を記録する。
render正常完了・context正常・通常プレイの条件が揃ったフレームだけを受理する。
初回同期描画、resize、メニュー中の描画、失敗した描画は計測しない。

投影の対象はAuroraの変形後の三角形内部（UVとshaderのalphaを評価）と、
Meteorの進行するhead/tailの明るい内部に限る。小パッチの全頂点がnear/far、
NDCの内側にあり、alphaと画面面積が最低基準を満たす必要がある。
透明quadの端・背面・画面外の部分は候補にしない。

遮蔽は静的前景の境界を初期化時に索引化し、候補への視線束と交差する境界が
あれば候補を棄却する。動的な前景は少数のMesh境界を更新する。境界は実形状を
包むため、輪郭や樹冠の隙間・月の半透明部分では**見えていても未観測になる**
保守性を許容する。完全なpixel可視性・全見え方の検出を保証しない。
シェーダー・地形・オブジェクト構成の将来変更時にはこの索引とUV評価の再点検が必要。
FIGHT／LANDING／RESULT中も観測を受理しない保守的な条件とし、QTE・釣果表示に
跨がる計測を避ける。観測の受理条件だけであり、釣りの時計・描画・操作は停止しない。

連続時間はイベントごとに直前の有効時刻を保持するだけで、最初のフレームは0秒。
不成立・別イベント・重複／逆行時刻・250ms超のgapで切断し、次の有効フレームを
新しい基準にする。通常30/60/120/144fpsは同じ0.5秒／0.1秒境界を用いる。
解除済みの種類の走査を止める。Math.random、ゲーム時計、天体sampleへの書き戻しはしない。

| 保存の入力 | 源版の検証 | 復元／writerの結果 |
| --- | --- | --- |
| V1/V2 未版／契約2 | 元12種、旧10／15件の厳密な達成集合 | 従来の新規魚種／装備移行を維持して契約6、観測2件は未解除 |
| V3 rev1／契約3 | 旧20種・15件 | rev3／契約6、旧日時保持、観測未解除 |
| V3 rev2／契約4 | 旧28種・16件 | rev3／契約6、旧日時保持、観測未解除 |
| V3 rev3／契約5 | 36種・旧17件とcollectionの完全一致 | 同rev3／契約6、17件の履歴をそのまま保持、観測未解除 |
| V3 rev3／契約6 | 旧17件の完全一致＋観測ID／UTC日時／非重複 | 19定義。観測は0件でも正規。秒数・偽metricは保存しない |
| 既知版の誤組合せ／未知将来版 | invalid-data／unsupported-versionを区別 | 後者は両スロットの書込み停止、原文保持 |

新IDは `normal-aurora-observed`（レクイエム／稀な天体イベントを観測する。）と
`normal-meteor-observed`（星に願いを／非常に稀な天体イベントを観測する。）。
解除は内部 `recordObservation('aurora' | 'meteor')` だけから行い、各1回。
ドメインはThree.js・視野判定をimportしない。保存するのは解除IDと解除日時だけ。

## 検証計画と証跡

Unitは既存全件、新規ドメイン／移行／投影／遮蔽／実時間／submit／中断／RNGを追加。
Build、diff --check、PC/touch smoke、実績UI/notice、保存、SkyCheck、final-stability、
Meteor、Aurora world lightの関係ケースと新規描画観測specを局所実行する。
失敗診断は出力先を分けて保持し、実施件数・是正・未実施・CPU負荷・画像の結果を追記する。
ローカル全件E2E、GitHub ci-required、実機・聴感確認は未実施であり、成功扱いしない。

## 局所計測（実機の性能保証ではない）

同じ実地形・通常保存時計・native TPSカメラをNodeで240回ずつ計測した。
静的境界索引の初期構築は176.44ms（起動時1回）。投影＋遮蔽の中央値／p95は
Aurora画面内0.012／0.148ms、Meteor画面内0.005／0.122ms。
強制的に投影全走査した画面外Auroraは0.133／1.521ms、最大33.40msだった。
通常の完全背面カメラは実submitがないため本番ではこの全走査へ入らない。
同時にUnit／SwiftShader検証を実行していた値で、端末での上限保証ではない。
生計測は `/tmp/barb-sky5-cpu.json`、起動時コストと樹冠境界の過剰遮蔽は残留リスクとして記録する。

資源を作るのは既存factoryだけ。新観測器が生成するのはVector/Matrix/Box/Rayと
JS索引で、Geometry/Material/Texture/Light/WebGL target/passは追加しない。
Aurora/Meteor/Water/カメラ/時計/抽選の本番ソースは基準mainと同一。
lakeの変更は既存3Meshへの凍結された参照の公開だけで、updateやshaderの変更はない。

## 初回失敗と是正の記録

- 通常のnpm cache先への書込みが環境制限で失敗。`npm ci --cache /tmp/barb-npm-cache` で成功。lockfileは無変更。
- sandboxでNodeの子プロセスがEPERM。権限付きの局所実行で同じテストを実行し、検証条件は変更していない。
- PlaywrightのChromium CDN取得が403（許可ドメイン制限）。既存の `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` で `/usr/bin/chromium`（154.0.8037.57）を使用。CIのbrowser／設定は無変更。
- 全Unit初回は1317件中1313成功・4失敗。件数／writer版の期待値2箇所を19／6へ追従。
  scenery比較に必要な過去SHA `eb10aa13ec302a7a4c9b4a421a596f447c8f6e7c` を取得。
  本番ソースの未コミットを拒否する既存検査は、実装コミット後に再検証する。比較器は変更していない。
- 新規局所Unitで逆行時刻の再基準化と短横の流星パッチ面積不足を検出し、単調時刻切断と十分な発光パッチへ修正。関連28件が成功。
- PC Meteor新規E2E初回は、発光部が画面へ入る前のage 0.15秒から測っていたfixtureが失敗。
  同じ通常当選イベントの保存時刻をage 0.2秒へ変更（初回通常フレームはage 0.45秒）。実画面・実drawの下限／達成／再読込が成功。
- ネイティブdialogの新規E2E初回は、RESULTでない釣果dialogが通常HUDにより閉じられたため、
  開き続ける `collection-dialog.showModal()` へfixtureを訂正。開いていないdialogでの正常観測を誤解除として扱わない。
- UI fixtureの観測記録はメニュー閉鎖後の本番経路を模して、記録後に実績画面を開き直す。既存collection通知・スクロール／フォーカス処理は無変更。
- 関係E2E初回を別ジョブのpreviewへ接続して実行したため、その所有ジョブ終了でserverが閉じ、後続8件が接続拒否。
  final-stabilityは同時SwiftShader負荷下で既存120秒を超過。独立previewと描画E2Eの直列実行へ修正し、テストのtimeout／retry／workers／DPRは変更していない。
- R2 E2Eの旧beforeAllがSky-5をR2導入差分へ混入したとして拒否（1失敗・2未実行）。
  R2導入証明は無変更のまま、上記のSky-5限定source tree証明を撮影・比較CLI・最終ゲートへ接続。
  専用Unit4件（34組／68画像・実改変source・raw破損・CLI nonzero・最終ゲート拒否）が成功。

失敗ログは `/tmp/barb-sky5-*.log`、診断・PNG・JSON・traceは
`test-results/sky5-*` に分離して保持。生成物はコミットしない。
新specはCIの既存L2収集・診断artifactへ入り、画像／JSONを自動添付する。
