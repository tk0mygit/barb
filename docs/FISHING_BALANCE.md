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
                   × 魚種の水深適性 ^ ルアーの水深適性 × 魚種の昼夜適性 × ロッドのTier倍率
魚種の確率 = 有効ウェイト / 全魚種の有効ウェイトの合計
```

旧公開APIの `getSpeciesProbabilities(lureId, conditions)` と `sampleFishSpecies(lureId, random, conditions)` は補正なしのまま維持します。
Phase 5B-1Bから、公開ゲームのBITEは下記の製品用 `encounterModel.sample()` を使用します。
条件を省略した旧呼び出しは環境倍率1で従来の確率を維持します。
旧公開APIは未定義の基本ウェイト・適性を1にする互換動作を維持します。
製品用モデルは全定義を厳密に要求するため、魚種追加時にはTier・全ルアー・全環境の明示登録が必要です。
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
巻き取り速度 = ファイト開始時の残距離 / (fightReelSeconds × 巻き取り用抵抗)
               × リールのreelSpeedMultiplier × 大型魚補助（対象外は1）
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
Phase 5A-1ではゲームへ接続せず導入しました。Phase 5B-1Bから `encounter-production.js` が
既存12魚種・4ルアー・全深度/昼夜・基本weight・Tierを注入して製品インスタンスを一度だけ構築します。
旧 `fish-encounters.js` のexport・未登録魚種の中立fallback・返却値の可変性は維持します。

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

## 上位装備効果の公開接続（Phase 5B-1B）

成功した `prepare()` で固定したロッド行を、`FISH_RARITY` に従う12魚種ID別のmodifierへ展開します。
BITEは既存factoryの共通演算で `W'_i = W_i × modifier_i`、`P_i = W'_i / ΣW'_j` とします。
確率への加算・抽選後の差し替え・再抽選はありません。乱数は従来の待ち時間1回の後、BITEで魚種1回、続けて体長1回です。
丸め済み体長・重量・`state.encounter` の構造と固定タイミングを維持します。

| 装備Lv | Common | Uncommon | Rare | リール大型魚補助 |
| --- | ---: | ---: | ---: | ---: |
| 1〜5 | 1.00 | 1.00 | 1.00 | 1.00 |
| 6 | 1.00 | 1.02 | 1.10 | 1.03 |
| 7 | 1.00 | 1.04 | 1.20 | 1.06 |
| 8 | 1.00 | 1.06 | 1.30 | 1.09 |
| 9 | 1.00 | 1.08 | 1.40 | 1.12 |
| 10 | 1.00 | 1.10 | 1.50 | 1.15 |

これは相対weightの倍率です。Rareの実際の当選確率が1.50倍になる意味ではありません。
全24条件でRare合算確率とUncommon/Common・Rare/Commonの相対比が上がり、全12種が正の確率を保持します。
正規化によりUncommon合算が下がる条件もあります。スピナーベイトの浅/昼・浅/夜・中/夜では、
Lv.1→10でそれぞれ15.211047%→15.136348%、22.189264%→21.955199%、24.543509%→24.499831%です。
Rare増加に伴う分母の変化であり、指定倍率は変更していません。ヒット時間・ポイント1.5倍・アクション1.35倍は従来のBITE速度だけに適用します。

大型判定は既存の丸め済み `lengthCm` と正規魚種レンジを使います。

```js
const relativeLength = (lengthCm - species.minLengthCm) / (species.maxLengthCm - species.minLengthCm);
const isLarge = lengthCm >= 70 || (lengthCm >= 40 && relativeLength >= 0.75);
```

アワセ時に対象個体の補助を固定し、FIGHTの巻取り距離だけに適用します。
LURE回収・テンション・抵抗clamp・4.5m下限・停止時の距離・ライン切れ/緩み逃走は既存のままです。
Lv.1〜5は新フィールドを追加せず中立値1とし、指定開始コミットの実エンジンと
全25装備組合せ×12種×3体長×3fpsの2,700条件で状態と乱数呼出数が完全一致します。
大型境界、1,620条件のFIGHT積分、旧288セル×5Lv、新288セル×5Lv、シード抽選と公開BITE境界を追加検証します。

新効果の表示/UIは5B-2、QTE/押し戻しは5Cへ留保します。保存version・15実績・価格・基本4性能・魚種と生態データは変更しません。

## Phase 5C-1：FIGHTドメイン更新

通常FIGHTの停止中に開始距離で縮小した押戻しを適用し、距離上限を開始距離に対して固定します。
物理を固定1/60秒へ揃え、通常長押しは成立時刻より前へ巻取りを適用しません。
装備と個体はそのファイトのsnapshot、共通profileはメタデータだけで、既存正弦抵抗は維持します。

QTEの難度・予約・結果・失敗後だけの復帰armはドメイン境界として実装していますが、
**通常起動のQTE出題は無効**です。未実装の操作UIで釣りを止めません。
入力/HUD、有限受信cutの具体値、売却/保存への接続は5C-2へ残します。
API・時計・世代・中断の契約は[FIGHTドメイン](FIGHT_DOMAIN.md)を参照してください。

## Phase 5C-1R：実機評価後の押戻し再調整

5C-1で承認・公開した基準速度は0.20m/sでした。実機評価とユーザーPMの追加決裁により、
5C-1Rでは0.80m/s（4倍）を採用します。通常FIGHTの非巻取り区間だけへ適用し、
`S=clamp((開始距離−4.5)/27.5,0,1)`と抵抗補正、開始距離+4mの上限を維持します。
QTE/失敗後arm中の停止、巻取り速度、テンション・逃走条件は従来通りです。

公開経路の適応長押しで測る釣獲時間の検証目標を20秒以内から30秒以内へ変更します。
これは単体テストの評価基準であり、ゲームが30秒で魚を失わせるタイマーではありません。
テスト内の観測ループも30秒へ揃え、180秒ストレス検証とQTEの制限時間は維持します。
ヒット待ちの平均10〜20秒、自動保存間隔、押戻し仕事量を除く正規化所要時間は別の基準です。

短距離のSを底上げしていないため、5.5mでは4倍でも1秒の後退が約3cmにとどまり、
0.1m刻みの距離表示に直ちに現れない場合があります。実機の体感はPMの再受入で確認します。
比較条件、20秒/30秒の判定差、内部QTE評価の注意点は[5C-1R検証報告](../README_5C1R.md)を参照してください。
