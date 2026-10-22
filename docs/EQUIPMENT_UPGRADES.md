# 装備強化データ・購入（Phase 3C-1A）

今回はDOM・描画に依存しないゲームロジックのみです。購入UI、キャスト・テンション・巻き取りへの性能反映、釣り状態による購入制限は追加していません。

## データ

`src/game/equipment.js` の `EQUIPMENT_LEVELS` にロッド・リールを独立した配列で定義します。外側のオブジェクト、配列、各行はすべて凍結しています。バランス調整はこの定義を変更します。

| 到達Lv | 費用 | ロッド飛距離加算m | ロッドテンション係数 | リール速度倍率 | リール緩和倍率 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 0 | 0 | 1.00 | 1.00 | 1.00 |
| 2 | 300 | 2 | 0.96 | 1.06 | 1.04 |
| 3 | 800 | 4 | 0.92 | 1.12 | 1.08 |
| 4 | 1800 | 6 | 0.88 | 1.18 | 1.12 |
| 5 | 3600 | 8 | 0.84 | 1.24 | 1.16 |

費用 `cost` はそのレベルへの到達費用です。累計は1装備6,500通貨、両装備13,000通貨です。性能値は常にLv.1基準で、前レベルから乗算を重ねません。
ロッドの項目は `castDistanceBonusM`・`tensionMultiplier`、リールは `reelSpeedMultiplier`・`tensionReliefMultiplier`。各行には `level`・`cost` も含みます。
`getEquipmentLevel(kind, level)` は指定レベル、`getNextEquipmentLevel(kind, currentLevel)` は次レベルの行を返します。装備IDは文字列の `rod`／`reel`、レベルは数値の整数1〜5のみです。不正なID・レベルはnullを返します。`getNextEquipmentLevel` は次レベルのないLv.5でもnullを返します。

## コレクションAPI

財布は引き続き `createCatchCollection()` が単一管理します。装備も同じコレクション内で管理し、別の財布を作りません。

| API | 戻り値・動作 |
| --- | --- |
| `collection.equipment` | 初期値 `{ rodLevel: 1, reelLevel: 1 }`。読み取り専用 |
| `collection.getUpgradeStatus(kind)` | `{ kind, currentLevel, next, canPurchase, reason }`。次レベルの費用・性能もnextから取得。不正IDはnull |
| `collection.purchaseUpgrade(kind, expectedCurrentLevel)` | 成功時 `{ kind, previousLevel, level, cost }`、失敗時null。次の1レベルだけ購入 |
| `collection.snapshot` | 既存スナップショットにequipmentを追加。JSON化可能 |

購入可能ならreasonはnull、残高不足は `insufficient-funds`、上限は `max-level`（nextもnull）です。内部の価格・残高に不正な値があれば `invalid-cost`／`invalid-balance` として購入不可にします。
照会値・購入結果・装備・財布は凍結し、取得済みの値は後の購入で変化しません。UIを接続するPhaseでは、照会は表示用に使用し、確定時は必ず購入APIで再検証します。

```js
const status = collection.getUpgradeStatus('rod');
if (status?.canPurchase) {
  const receipt = collection.purchaseUpgrade('rod', status.currentLevel);
  // receipt === nullなら未購入。最新の財布・装備・購入可能状態を再取得する。
}
```

`expectedCurrentLevel` は必須です。省略・不正値・現在レベルとの不一致を拒否します。購入後に同じ旧レベルの要求を送っても追加の購入は成立しません。次の強化には最新のレベルが必要です。ロッドの購入はリールのレベルを変えず、その逆も同じです。
購入額や到達レベルを呼び出し元から指定するAPIはありません。内部の凍結テーブルから次レベルと正規価格を取得します。

## 更新の一貫性

1. 装備IDと要求レベルを検証し、現在レベルとの一致を確認します。
2. 次レベルの有無、費用・残高が非負の安全な整数であること、残高不足でないことを確認します。
3. 減算後の安全な残高、装備、購入結果を新しい凍結オブジェクトで構築します。
4. await・コールバックを挟まず、財布と装備を同期的に置換します。

拒否時は財布・装備とも置換しません。残高が費用と等しいときは購入でき、残高0になります。
購入では `wallet.balance` だけを減らし、`wallet.lifetimeSales` を変更しません。その後の通常売却では従来どおり両方へ売却額を加算します。累計売却額10,000などの将来の実績判定は支出の影響を受けません。
捕獲履歴・保管状態・売却情報・図鑑統計には一切書き込みません。既存釣果レコードとスナップショットの `schemaVersion: 1` を維持し、equipmentを追加するだけです。

## 検証・未実装範囲

Node単体テストで全レベルの指定値・合計額、不変性、初期値、連続購入、残高ちょうど・不足・0、最大Lv、不正ID・レベル、古い要求の再実行、同じ要求の連続送信、失敗時不変、所持金と累計額の分離、購入後の即売却・個別／一括売却、履歴・図鑑維持、スナップショット・JSON化を検証します。Lv.5でも既存の釣り設定・距離・テンションが変わらないことも確認します。
実行コマンドは `npm ci`、`npm test`、`npm run build`、`npm run test:e2e`。既存ブラウザテストでPC・タッチ・釣り・操船・図鑑・保管・売却を確認し、最終結果はPRに記載します。

釣り性能への反映・強化UI・釣り状態による購入制限・実績・永続保存と復元は後続Phaseです。現在は装備もセッション中のみで、再読み込みで消失します。昼夜描画・霧・BGM・新魚種・非公開設定は追加していません。GitHub Pages設定は変更していません。
スマートフォン実機・Safariは未確認です。既存のThree.jsチャンクサイズ警告は継続しています。
