# 釣りバランス（Phase 3A-2〜3A-3b）

すべてゲーム用の暫定値です。生息地・生態の再現を目的とした確率ではありません。
魚種の説明・体長・重量・画像は [魚種データ](FISH_SPECIES.md) を参照してください。

## ルアーと魚種抽選

`src/game/lures.js` に4ルアーのID、表示名、`hitMultiplier`、魚種ID別の `affinities` を集約しています。
全種類を最初から使用可能です。`selectLure(id)` は `READY` のみ受け付け、準備中・キャスト後・失敗表示中・釣果画面では拒否します。
下部UIも同じ条件で表示・有効化し、準備解除・失敗後の復帰・釣果画面を閉じた後に再選択できます。選んだ種類は次のキャストにも引き継ぎます。

| ルアーID | 名前 | ヒット倍率 | 比較的適性が高い魚種の例 |
| --- | --- | --- | --- |
| minnow | ミノー | 1.05 | ニジマス、ブラウントラウト、イワナ、ウォールアイ |
| crankbait | クランクベイト | 1.00 | バス2種、ヨーロピアンパーチ、ウォールアイ |
| worm | ワーム | 0.90 | ブルーギル、ナマズ、ブラックバス |
| spinnerbait | スピナーベイト | 1.10 | ノーザンパイク、ブラックバス、アリゲーターガー |

適性は相対的な出やすさで、どのルアーでも12種すべてが釣れます。
`src/game/fish-encounters.js` の `APPEARANCE_WEIGHTS` は以下の基本ウェイトを持ちます。

| 魚種ID | ウェイト |
| --- | --- |
| black-bass | 24 |
| smallmouth-bass | 14 |
| bluegill | 18 |
| rainbow-trout | 12 |
| brown-trout | 9 |
| iwana | 8 |
| northern-pike | 6 |
| european-perch | 12 |
| walleye | 8 |
| catfish | 10 |
| alligator-gar | 3 |
| arowana | 4 |

```text
魚種の有効ウェイト = 基本出現ウェイト × 選択ルアーの魚種適性
                   × 魚種の水深適性 ^ ルアーの水深適性 × 魚種の昼夜適性
魚種の確率 = 有効ウェイト / 全魚種の有効ウェイトの合計
```

`getSpeciesProbabilities(lureId, conditions)` が確率を計算し、`sampleFishSpecies(lureId, random, conditions)` が抽選します。
条件を省略した旧呼び出しは環境倍率1で従来の確率を維持します。
新魚種は `FISH_SPECIES` に追加すると抽選対象となり、明示的な設定がなければウェイト1・適性1になります。追加時には各値の調整とテスト更新を推奨します。
Phase 3A-3bで水深・昼夜による補正を実装しました。ルアーの水深適性は水深による有利不利の強さを調整し、全魚種共通の係数が正規化で消えることを避けています。
数値と式の詳細は [水深と時間帯](DEPTH_AND_TIME.md) を参照してください。
Phase 3A-3aの[釣りポイント](FISHING_SPOTS.md)はアタリ発生率のみを補正し、この魚種抽選確率には影響しません。

アタリの間隔と魚種の構成は別計算です。待機3秒の後、平均12秒の指数分布の待ち時間をヒット倍率で短縮・延長します。
操作なしの理論平均は `3 + 12 / hitMultiplier` 秒（約13.9〜16.3秒）です。フリック中は既存の1.35倍も適用します。
各キャストが10〜20秒以内に収まる保証はありません。単体テストではルアー別1,000回の平均が10〜20秒内に入ることを確認しています。

アタリ時に魚種と体長を抽選し、`state.encounter` に `speciesId`・`lengthCm`・`weightKg` と、追加項目 `conditions` に抽選時の水深・昼夜・ルアー位置などを固定します。
アワセでは再抽選せず、ファイト・ランディング・釣果まで同じ個体を使用します。
失敗や回収から `READY` に戻ると個体を解除します。釣果のスキーマversion 1とブラックバスのID・重量式は維持します。

## ファイト

`src/game/fish-fight.js` が魚種データの基本抵抗・体長増加・周期的な引きを計算します。
個体差は体長・重量のみで、独立した性格・能力抽選はありません。

```text
抵抗 = baseResistance + (体長 - minLengthCm) / lengthScaleCm
       + surgeAmplitude × sin(ファイト経過秒 × surgeFrequency)
巻いている間のテンション増加/秒 = tensionRise × 抵抗 × ロッドのtensionMultiplier
離している間のテンション減少/秒 = tensionRelief × リールのtensionReliefMultiplier
巻き取り速度 = ファイト開始時の残距離 / (fightReelSeconds × 巻き取り用抵抗) × リールのreelSpeedMultiplier
```

距離計算の「残距離」はランディング地点までの距離です。
`src/game/fishing-config.js` の `reelResistanceMin: 0.8` と `reelResistanceMax: 1.25` で巻き取り用抵抗を制限します。
小魚が即座に釣れたり、大型魚の巻き取り時間が極端に伸びたりするのを避けるためです。
テンションには制限前の抵抗を適用するので、大型魚ほど細かく緩める操作が必要です。
過大テンションのライン切れ、過小テンションが続いた場合の確率的な逃走は従来どおりです。

初期設定・全12種×4ルアー×最小／中間／最大体長×30／144fpsの288通りで捕獲まで検証しています。
100msごとにテンションを確認し、35%未満で押し始め、65%超で離す操作（長押し判定220ms込み）では、
通常の魚種が約6.6〜14.9秒、アロワナ最大約15.6秒、アリゲーターガー最大約16.9秒でした。
反応速度や操作方法によって時間は変わります。実機での操作感は今後も調整対象です。

## 表示・検証・今回の範囲

釣果画面は `speciesId` で魚種定義から名前・SVG・代替テキストを取得し、捕獲個体の体長・重量を表示します。
画像を差し替えてもゲームロジックの変更は不要です。ルアーの線画アイコンは `src/ui/lure-picker.js` に分離しています。

単体テストは確率・適性・出現分布・操作制限・抵抗差・全種捕獲を検証します。
ブラウザテストはマウスとモバイル相当タッチ、縦横レイアウト、キャンセル・アワセ失敗・ライン切れ・再挑戦を確認します。
全12種のブラウザ捕獲テストは乱数と時計のみ制御し、本番ビルドのキャストから釣果まで進め、実際に読み込まれたSVG内容も照合します。

装備購入UI・実績・自動セーブはPhase 3C-1D／2／3Bで実装済みです。消耗、昼夜の描画・霧・BGMは未実装です。
公開済みの通常12魚種のみを使用し、非公開の魚種やストーリーは追加していません。

魚図鑑・釣果保管は[Phase 3B-1](CATCH_COLLECTION.md)で追加し、記録は自動保存・起動時復元の対象です。
売却・所持金・買取人は[Phase 3B-2](FISH_SALES.md)で追加しています。売却履歴・所持金は自動保存し、買取人の一時通知は復元しません。

装備の購入APIと釣り性能はPhase 3C-1A〜1Cで実装済みです。キャスト準備時に固定し、途中の購入は次の準備から反映します。全12種・体長3通り・30/60/144fpsで、ロッド／リールLv.1／5の4組合せを検証しています。最大強化時は5.52〜11.57秒で捕獲し、大型魚の連続巻き取りによるライン切れ・放置による緩み逃走も維持しています。条件・測定値は[装備性能](EQUIPMENT_UPGRADES.md)を参照してください。

## 独立した遭遇モデルのデータ契約（Phase 5A-1）

`src/game/encounter-model.js` の `createEncounterModel(config)` は、魚種数に依存しない純粋なfactoryです。
公開ゲームは従来の `fish-encounters.js` を使用します。既存export・未登録魚種の中立fallback・返却値の可変性は維持します。
新モデルはゲームへ接続しておらず、装備Lv別の倍率も定義していません。

必須設定は次の6項目です。すべての魚種・ルアーと全セルを明示します。

| 設定 | 契約 |
| --- | --- |
| `registry` | `createFishSpeciesRegistry(...)` の返すregistry、または同じ魚種定義を持つ `{ species: [...] }`。順序はこの配列が一次情報。`get` による再lookupは行わない |
| `baseWeights` | 全魚種ID → 基本weight |
| `lures` | 順序付きの `{ id, affinities: { 全魚種ID: 係数 } }` 配列。既存の `LURES` も渡せる。ヒット倍率などは抽選に使用しない |
| `environmentAffinities` | 全魚種ID → `{ depth: { shallow, mid, deep }, time: { day, night } }` |
| `lureDepthExponents` | 全ルアーID → `{ shallow, mid, deep }`。値は水深適性の指数 |
| `tiers` | 全魚種ID → `Common` / `Uncommon` / `Rare`。追加魚種にも明示登録が必要 |

`fish-rarity.js` の `FISH_RARITY` は承認済み12種の固定分類です。
Commonは `black-bass`・`smallmouth-bass`・`bluegill`・`rainbow-trout`・`european-perch`、
Uncommonは `brown-trout`・`iwana`・`walleye`・`catfish`、Rareは `northern-pike`・`alligator-gar`・`arowana`。
これはゲーム上の補正分類であり、生物学的な希少度ではありません。魚種定義へのプロパティ追加やweight変更はありません。
`getFishTier(id)` は未知IDを拒否し、`defineFishRarity(speciesIds, tiers)` は全件網羅・有効Tier・既存12種の固定対応を検証します。

| メソッド | 返却値・動作 |
| --- | --- |
| `getProbabilities(lureId, conditions, modifiers?)` | 魚種順の `{ speciesId, weight, probability }` 配列 |
| `sample(lureId, random, conditions, modifiers?)` | 魚種乱数を正確に1回消費し、注入registry由来の魚を返す。乱数の既定値は `Math.random` |
| `audit(lureId, conditions, modifiers?)` | `{ lureId, conditions, totalWeight, entries }`。各行にTier、基本weight、ルアー適性、水深適性・指数・累乗結果、昼夜適性、環境係数、modifier、有効weight、確率を含む |

3メソッドは同一の計算経路を使用します。旧経路の浮動小数点演算順に合わせ、
`(baseWeight * lureAffinity) * ((depthAffinity ** lureDepthExponent) * timeAffinity) * modifier` を計算します。
重み・総和・確率は有限正数を要求し、確率合計誤差は `1e-12` 以内です。
乱数は有限の `[0, 1)` のみを受け付け、累積区間は `roll < cumulative` と末尾丸め救済を維持します。

`conditions` の `depthM`・`timeOfDay`・記録用 `cycleProgress` は旧 `normalizeEncounterConditions` と同じ意味です。
省略・不正な個々の条件はその補正を1にします。設定の欠落は中立化せず例外にします。
`modifiers` は任意の部分的な `{ 魚種ID: 乗数 }` で、省略または未指定IDは1です。Tierを自動的に倍率へ変換しません。
未知ID、0、負数、非有限値、数値文字列などを拒否し、設定や他の呼び出しに状態を残しません。

型の誤り・必須項目欠落・疎配列は `TypeError`、重複ID・未知キー/Tier・不正範囲・計算時のoverflow/underflowは `RangeError` です。
エラーには対象フィールドやIDを含めます。全係数を数値の有限正数として検証し、不明ルアーと不正な乱数は `RangeError` にします。
入力は防御コピーし、`definitions` と全返却値を再帰的にfreezeします。
深くfreeze済みの魚種定義は注入registryと同じ参照を維持し、可変の魚種定義は独立したfreeze済みコピーを返します。

開発時の監査は次のコマンドでJSONを出力します。生成物はコミットしません。

```bash
node scripts/audit-encounters.mjs > /tmp/barb-encounters.json
```

現在の本番定義を直接読み、4ルアー順×水深1/5/12m×day/night×魚種順の288行を出力します。
各行で条件・魚種・補正構成・総weight・確率を追跡できます。
`tests/encounter-model.test.js` はこの出力、旧12種の288セル一致、Node内だけの架空36種864セル、厳密なデータ検証とモデルの独立性を検証します。
