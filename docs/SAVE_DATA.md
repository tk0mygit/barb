# セーブデータ基盤（Phase 3C-3A）

`src/game/save-data.js` は保存データの作成、JSON変換、検証、ドメイン再構築を提供します。
DOM・Three.js・ブラウザストレージへの依存や副作用はありません。
**localStorage、自動保存、起動時の読み込み、保存UIは未接続です。再読み込みすると現在のゲーム記録は失われます。**
これらの接続はPhase 3C-3Bで行います。

## 正式スキーマ v1

```json
{
  "saveVersion": 1,
  "savedAt": "2026-10-23T00:00:00.000Z",
  "collection": {
    "catches": [],
    "wallet": { "balance": 0, "lifetimeSales": 0 },
    "equipment": { "rodLevel": 1, "reelLevel": 1 }
  },
  "achievements": { "unlocked": [] },
  "boat": { "x": 0, "z": 30, "heading": 0 },
  "clock": { "elapsedSeconds": 0 },
  "settings": {}
}
```

上記フィールドはすべて必須です。各オブジェクトは以下に列挙するフィールドだけを許容します。
未知フィールドを黙って削除しません。設定は予約領域の空オブジェクトのみです。
外側の `saveVersion` は、既存の `collection.snapshot.schemaVersion: 1` と釣果の
`schemaVersion: 1` から独立しています。既存スナップショットの形は変更しません。

`collection.catches` だけが捕獲履歴の正規データです。`storedIds`、`encyclopedia`、
装備の価格・性能、実績進捗、釣りの途中状態は保存しません。

| 釣果レコードのフィールド | 型・規則 |
| --- | --- |
| `schemaVersion` | 数値の `1` |
| `id` | 空白だけでない文字列、256 UTF-16コード単位以内、履歴全体で一意 |
| `speciesId` | `fish-species.js` の通常12魚種のID |
| `lengthCm`, `weightKg` | 有限の正数。既存 `register()` の正当な個体差を保つため、現在の抽選体長範囲や重量式への完全一致は強制しない。重量は単体売価が安全な整数になる範囲 |
| `caughtAt` | 有効なUTC ISO日時文字列 |
| `disposition` | `unassigned` / `stored` / `sold` |
| `salePrice`, `soldAt` | `sold` の場合だけ両方必須。価格は非負の安全な整数、日時は有効なUTC ISO文字列 |
| `conditions` | 任意。下記のオブジェクト。省略も許容 |

`conditions` の各フィールドも任意です。実際の生成形式に加え、既存の部分的な遭遇条件も受理します。

| フィールド | 規則 |
| --- | --- |
| `depthM` | 非負の有限数、または `null` |
| `depthBand` | `shallow` / `mid` / `deep` / `null`。`depthM` もあれば既存 `getDepthBand()` の結果に一致 |
| `timeOfDay` | `day` / `night` / `null` |
| `cycleProgress` | 0以上1未満の有限数、または `null` |
| `lureId` | 既存4ルアーのID |
| `lurePosition` | 有限数の `x`, `z` だけを持つオブジェクト |

日時は `Date.toISOString()` のUTC形式（拡張年も含む）を受理します。
秒以下なし、または1〜3桁の小数も許容し、元の文字列を維持します。
存在しない日付の繰り上がり、無効日時、UTC以外の表記を拒否します。
OS時計の修正やテストの時刻注入を許すため、捕獲・売却・保存・実績日時の前後関係は強制しません。

財布は `balance` / `lifetimeSales` とも非負の安全な整数です。
`lifetimeSales` は売却済み履歴の `salePrice` 合計に一致し、`balance <= lifetimeSales` を要求します。
累計売却額を残高から逆算しません。過去の売価を現在の単価で計算し直したり、
残高を現在の装備価格から補正したりしません。これにより、購入後も累計額と過去の売価を維持します。
購入費用と残高の厳密な再会計や改ざん検知は提供しません。
装備レベルはそれぞれ整数1〜5、復元後の性能・次回価格は既存 `equipment.js` を参照します。

`achievements.unlocked` は `{ id, unlockedAt }` の配列です。
IDは通常10実績の安定IDのみで、重複不可、日時は上記のUTC ISO形式です。
解除済み集合と、捕獲履歴・累計売却額・装備から再計算した達成条件の集合が完全一致することを要求します。
現在の条件はすべて単調増加なので、達成済みの履歴欠落・未達成なのに解除済みの両方を破損として拒否します。
日時を復元時刻で作り直す補修はしません。

船の `x`, `z`, `heading` は有限数です。方向は既存操船と同様にラジアンで、角度の巻き戻しはしません。
座標は `hypot(x,z) <= shoreRadius(atan2(z,x)) - LAKE.boatMargin` を要求します。
既存の湖岸衝突処理の丸め誤差だけを許容するため、半径の `16 * Number.EPSILON` 倍の余裕があります。
範囲外座標を湖内へ丸めて採用する処理はありません。
時計の `elapsedSeconds` は非負の有限数で、既存の昼180秒・夜180秒の周期を継続します。

## API

```js
import {
  createSaveData, validateSaveData, serializeSaveData, parseSaveData,
  restoreSaveData, tryRestoreSaveData, SaveDataError, SAVE_VERSION, SAVE_LIMITS,
} from './src/game/save-data.js';

const data = createSaveData({ collection, achievements, boat, clock: gameClock });
const json = serializeSaveData(data);
const parsed = parseSaveData(json);
const candidate = restoreSaveData(parsed);
// candidate = { collection, achievements, boat, clock, fishing }
// ここまで既存ゲーム・表示・保存領域を変更しない。
```

| API | 契約 |
| --- | --- |
| `createSaveData(state, { savedAt } = {})` | 現在状態から正規データを取り出して検証。`savedAt` 省略時は現在のUTC日時。元の状態を変更せず、分離した深い凍結データを返す |
| `validateSaveData(data)` | JSON変換前のオブジェクトを検証し、分離した深い凍結データを返す。未処理魚の状態はまだ変えない |
| `serializeSaveData(data)` | 検証してJSON文字列を返す |
| `parseSaveData(json)` | 入力長を制限してJSONパースし、スキーマ検証した凍結データを返す |
| `restoreSaveData(data, { now = Date.now } = {})` | 全体検証後、新しいドメイン一式を構築して返す。既存状態を引数に取らない。`now` は復元後の新規イベント用 |
| `tryRestoreSaveData(json, options)` | JSONからの復元成功時 `{ ok: true, state }`、想定内の入力失敗時 `{ ok: false, error: { code, path } }` |

前5 APIは入力失敗時に `SaveDataError` を投げます。`code` と `path` は公開契約です。
エラーメッセージに入力の内容を埋め込みません。`tryRestoreSaveData` はこの例外だけを分類し、
プログラミングエラーなどの予期しない例外は呼び出し元へ伝えます。

| `code` | 意味 |
| --- | --- |
| `invalid-json` | JSONの構文エラー |
| `invalid-data` | 必須項目欠損、型・範囲・日時・整合性違反などの破損 |
| `unsupported-version` | 有効な非負整数のバージョンが `1` 以外。移行・部分復元なし |
| `input-too-large` | 入力テキスト・捕獲数・IDなどが防御上限を超過 |

オブジェクトAPIはJSON相当の通常データを受け取ります。アクセサ、未知のプロトタイプ、
循環する未知フィールド、疎配列を拒否します。任意のProxyや実行可能なJSオブジェクトを扱うサンドボックスではありません。
`SAVE_LIMITS` はJSONが64 Mi UTF-16コード単位、捕獲履歴100,000件、ID256コード単位です。
これは異常入力からメモリと処理時間を守る転送上限で、ゲーム内の保管容量制限ではありません。
復元時の索引・統計は線形時間で再構築します。未知フィールドを再帰コピーせず、既知の浅い構造だけを検証します。
非常に長いプレイ履歴の保存方式・上限引き上げは別途設計が必要です。

## 再構築と安全な採用順序

1. JSONをパースし、全フィールド・履歴の整合性・実績条件を検証します。
2. 新しいコレクションを生成し、捕獲履歴から個体ID索引、魚種別件数・最大体長、保管一覧を構築します。
   `unassigned` はすべて `stored` に変更します。捕獲ID・魚種・サイズ・日時・遭遇条件・実績は保持し、売却しません。
3. 保存位置・方向の新しい船を速度0・`mode: 'sailing'` で生成します。
   新しい釣り状態は `PHASE.READY`、釣果・遭遇・巻き取り状態なしです。
   キャスト・ファイト・ランディング・ダイアログ・姿勢やカメラの途中アニメーションを引き継ぎません。
4. 時計を保存した `elapsedSeconds` で生成します。保存日時からの差分やブラウザを閉じていた時間は加算しません。
5. 解除履歴を実績管理へ反映してから初回評価と購読を行います。
   既存解除は評価結果・通知へ再送せず、復元後の新しい捕獲・売却・強化は通常どおり評価・通知します。
6. 全構築成功後だけ候補一式を返します。呼び出し側は入力・更新を止め、候補に結びつくUI・カメラ・入力の準備も成功させてから
   状態一式を採用してください。旧コレクションに結びついたUI参照を使い回さないでください。
   旧実績管理の `dispose()` と旧表示の後片付けは採用が確定してから行います。

本PRでは手順6のゲーム起動・表示への接続を実装していません。候補生成が失敗しても現在のゲームへの参照・購読には触れません。
新しい釣果IDは既存索引へ照会し、保存履歴に次の連番IDが存在しても、OS時計が戻っても衝突を避けます。

個別の基盤APIとして `createCatchCollection({ initialData, now })`、
`createAchievements({ collection, initialData, now })`、`createBoatState({ x, z, heading })`、
`createGameClock(config, { elapsedSeconds })` も使用できます。初期値省略時の新規ゲーム動作は従来どおりです。
ゲーム全体の復元には、必ず外側の検証・構築を一括で行う `restoreSaveData` を使ってください。

## Phase 3C-3Bへの引継ぎ

- 読み込み候補の検証・再構築が完了するまで現在のゲーム状態を変更しないこと。
- 読み書き失敗、アクセス拒否、容量超過、破損、未対応バージョンを分けて扱うこと。
  どの失敗でも現在のゲームや既存の保存文字列を不必要に削除・上書きしないこと。
- `savedAt` を時計の経過時間として扱わないこと。通知表示には新規解除の購読だけを接続し、復元した `snapshot` を送らないこと。
- UI参照・操船モード・入力・カメラも含めて採用を接続すること。本PRをマージしただけでは自動保存・自動復元されないこと。
- 将来フィールド・魚種・実績条件・通貨規則を変更する場合は外側の `saveVersion` を更新し、
  明示的な移行関数と移行前後の検証・テストを追加すること。既存データへ暗黙の初期値を補わないこと。
  特に実績条件を変更する移行では、過去の解除日時を維持する方針を別途定義すること。

## 検証

`tests/save-data.test.js` は初期値・往復変換・不変性・厳格な拒否・部分復元なし・12魚種・売却・
未処理魚救済・ロッド／リール全25レベル組合せ・10実績・ID衝突・湖岸の実操船境界・
180/360秒・30/60/144fps・20,000件の履歴を確認します。
`tests/browser/save-data.spec.js` はテスト時だけ復元APIを接続し、マウス／タッチでメニュー表示・
救済魚へのアクセス・復元通知なし・新規達成通知を確認します。本番にデバッグAPIや読み込み処理は追加しません。
