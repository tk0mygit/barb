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
