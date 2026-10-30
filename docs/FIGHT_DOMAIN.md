# FIGHTの時計・入力・QTE接続境界（Phase 5C-1）

通常起動の`createFishing()`はQTEを有効化しない。押戻し・物理時計・長押しの更新は通常の
FIGHTへ適用する。QTE HUD、ポインター4操作、売価、釣果成功数、保存形式の変更は含まない。

5C-1の公開基準速度0.20m/sに対し、5C-1Rは0.80m/sを採用する。
通常の非巻取り区間で`0.80 × S × clamp(抵抗,0.8,1.5)`m/sを加算する。
`S=clamp((開始距離−4.5)/27.5,0,1)`、着岸下限4.5m、開始距離+4m上限は維持する。
ユーザーPMの追加決裁による30秒は公開経路の釣獲時間を測るテスト目標であり、
このドメインに時間切れの強制終了処理を追加しない。180秒研究打切り、QTE期限、
正規化仕事量の評価軸とは区別する。[比較と決裁履歴](../README_5C1R.md)を参照。

## 責務

- `fight-qte.js`：有限十進と0.1cm整数による厳密な難度比較、予約、結果の純粋関数。
- `fish-fight.js`：既存正弦抵抗と大型判定。共通profileの連続重みはメタデータのみ。
- `fight-controller.js`：個体・開始距離・装備の一時snapshot、固定物理時計、通常入力の時刻列、
  FIGHT内のQTE補助状態と結果の単一適用。DOM・Three.js・コレクション保存に依存しない。
- `fishing.js`：既存PHASE・LURE/BITE抽選・釣果登録を維持し、FIGHTだけをcontrollerへ委譲。
- `input/fishing.js`：DOMの単調timestampを有効なゲーム時計へ写像し、down/upをキューへ渡す。
  LUREの長押し・フリック、BITEのタップ、キャストの既存経路は保持する。

`state.fight`は読み取り用の凍結snapshot。通常時間、処理済みFIGHT時間、render受理時間、
装備/profile/難度、入力世代、予約、QTE状態、効果件数、距離収支、逃走draw数を含む。
コレクション/セーブへ渡さず、`state.encounter`や既存釣果レコードへフィールドを追加しない。

## 時計と入力

物理は固定1/60秒。render余りdtを保持し、tick内をdown/up、hold満了、QTE/arm境界で分割する。
hold成立より前の区間へ巻取りを遡及しない。同着upはその境界後の巻取りを無効にする。
QTEと失敗後armでは通常時計・抵抗位相・距離・テンション・slack・逃走drawを止める。
armは失敗後のみ固定長、無接触で延長しない。世界/昼夜時計は従来のmainループが独立に進める。

入力受信時の物理snapshotは最大1tick遅れている。通常down/upの受理はそのsnapshotのowner
だけで決めず、発生時刻に処理したownerとcontact識別子で決める。QTE前/中の接触は解決後へ
持ち越さない。正常な新規downが同じrender内の解決より先に配送されても失わない。
pause/resume/cancelの世代も区別し、古いupが新しいdownを解除しない。

補償和によるdt受理と機械精度のtick比較を使う。通常入力のclock変換に伴う数ulpは、既存の
意味境界（結果/arm/hold）へ合わせる。入力時間の猶予・難度epsilonではない。Dの閾値は
有理数交差積で判定し、QTEのDOM発生時刻/受信cutの採点は本工程に実装しない。

FIGHT内の逃走判定だけは固定格子化に伴うdraw消費の変化を許容する。確率式は既存のまま。
ヒットまでの乱数順・魚種/体長抽選・装備定義は変更せず、QTEは乱数を消費しない。

## 明示的な内部接続

テストや後続の正規アダプターだけが、`createFishing({ qte: { enabled: true, selectOperation } })`
を明示する。operation providerなしの有効化は拒否する。標準のmainには渡していない。
`onFightEvent`はwarning/active/結果/arm終了/一時停止/終了のsnapshotを通知する。

| API | 契約 |
|---|---|
| `fightContact(type, at, generation)` | 現在の通常ownerの明示入力。旧世代は拒否 |
| `queueFightContact(type, at, identity)` | 通常timestamp ingress。処理時owner・接触対応・lifecycleで採否を決める |
| `submitQteResult(token, success, at)` | 検証済みの結果だけを渡す。fight/index/generation一致、単一適用。未来の確定時刻も指定可 |
| `pauseFight()` / `resumeFight()` | 残時間/予約/結果件数を保ち、入力世代を更新。最初からの無料リセットや魚喪失なし |
| `cancelInput()` | 通常接触を解除。QTE中は入力世代だけ失効し、残時間/魚/予約を維持 |
| `abortFight()` | 呼出側が明示した中止のみ。残予約を取消してREADYへ。ライフサイクルから自動実行しない |

予告と操作時間が尽きても、domainは勝手に失敗を確定しない。`awaiting-result`を保持し、
後続の単一commitから結果を受け取る。正常公開経路はQTE不活性なのでここで停止しない。
結果適用自体はFAILEDへ遷移させず、通常再開後の既存糸切れ/緩み逃走が失敗を決める。
成功補助で着岸下限へ到達しても、残予約を消化するまで早期LANDINGにしない。

## 5C-2への留保

5C-2-1は以下の明示接続APIを追加する。通常起動と復元は引き続きQTE無効。
4操作の実採点/HUD・独立operation provider・本番全経路composition・販売/保存は後続工程。

### 5C-2-1：独立時計と有限配送の内部接続

- `createQteClock()`は同Windowのperformance時計（ms）からactive時間Eを作る。
  標準は相対timestampのみ。epoch互換は固定`timeOrigin`と明示モードが必須。
  source/receiptを別々に写像し、未来・不正・保持範囲外・suspend境界の曖昧値を拒否する。
  通常入力のorigin再基準化と世界時計は変更しない。
- 内部factoryで`qte: { enabled: true, delivery: 'finite', selectOperation }`を指定した場合だけ、
  domainはwarning開始で通常render時間の受理を止める。`advanceQteDelivery(token, E相対秒, A相対秒)`で
  QTE時間だけを進め、表示未準備では0.6秒の境界、表示後は固定cutで止める。
  `commitQteDelivery(token, success)`はcut到達後だけ同期適用する。結果後の通常時間を
  呼出側が明示受理するため、待機中のrender dtやdt capを通常物理へ溜め込まない。
- `createQteDelivery({ fishing, clock, evaluate })`は輸送と台帳を担当する。`open(warningTimestamp)`の
  timestampは呼出側が特定したwarning開始source anchor。同じ論理再生は同じanchorと表示機会を供給する。
  rAF消費時刻をsource/receiptへ読み替えてはならない。本PRでは標準mainにadapterを生成しない。
- `prepareDisplay(frameId)`の返すhandleを、geometry確定後の後続表示機会で
  `presentDisplay(handle, laterFrameId)`へ返す。初回Aは0.6秒以降で、その後のD/Cは不変。
  このAPIは物理画面の発光を保証しない。実HUDとの結線・端末録画確認は別工程。
- `controls`は入口の最初にreceiptを読み、capture/focusより前に`receivePointer`へ渡す。
  `createFishingInput(fishing, mapping, { qteDelivery })`はこの受信結果を再利用する。
  cut後の通常fresh downには論理時刻を保持し、旧QTE upを通常holdへ混ぜない。
- `A <= E(source) <= D`かつ`E(receipt) < C`のみ受理し、`now >= C`でsealする。
  `qte-delivery-config.js`の100ms/128edgeはS1の**端末測定前の暫定初期値**。
  同一Eventだけをdedupし、同timestampの別Eventはsource/ingress順を保持する。
- semantic edgeは有限。move/coalescedは始点・up終点・最大変位と時刻・contactへ集約する。
  `evaluate({ previous, edges, completedOperations, final })`は後続採点器の注入口。
  戻り値は`{ success, completedOperations }`で、0～3の完了数と成否だけが中断checkpointに残る。
  Unitの合成consumerを4操作の採点成功として扱わない。
- overflowは`interrupted`とbounded診断へ明示し、魚・予約・消費時間・完了数を保持して停止する。
  `resumeTechnical()`後も残窓だけを使い、表示再確定とfresh downが必要。
  残0で失われた証拠を復元できなければcutで当該QTEだけ一度FAILとする。
- `setSuspended(reason, active, receipt)`はhidden/blur/menu/pageを集合で管理する。
  active中の復帰は表示準備理由も解消してから。回転は`invalidateGeometry(true)`で停止し、
  warning中でもgeometry再確定で復帰可能。小幅resizeの`false`はD/Cを延長しない。
  canvas blurは接触を取消す。途中FIGHTのreload保存は対象外。

台帳キーはadapter instance・domain factory instance・fightId・QTE index。入力世代更新でも
seal済み台帳を再作成しない。tokenはfactory参照にも束縛し、別factoryの同番号を拒否する。
従来の`submitQteResult`も未来の重複enqueueを拒否するが、trueは適用通知ではない。
有限経路の成否適用は`commitQteDelivery`の戻り値とdomain snapshotで区別する。

端末の遅配分布、0.5秒窓、coalesced挙動、64/128/256容量とCPU、BFCache/回転・表示の
実機結果は未確認。合成Unit、Chromiumタッチ相当、既存画像比較を端末受入へ読み替えない。
