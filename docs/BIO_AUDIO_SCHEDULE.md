# 生物環境音の発声予定（Phase 4.5-D-2B-2）

`src/audio/bio-schedule.js`は予定を生成・消費する独立モジュール。
既存`createGameClock().state`を入力とし、DOM、描画、Web Audio、factory、再生ノード、音量、霧に依存しない。
音源の長さだけを原本manifestから読み、WAVのURLや音源factoryはimportしない。
承認済みD-2B-1コミット`880e6d442067336a8a183f4e0b3d385f3887aa8d`のファイルは変更しない。

## API

```js
import { createBioScheduler, createBioCyclePlan } from './audio/bio-schedule.js';

const scheduler = createBioScheduler(); // seed省略時: 0x42494f32
const plan = scheduler.getPlan(clock.state); // 現在の360秒周期の凍結された計画
const event = scheduler.update(clock.state); // null または予定イベント1件
scheduler.update(clock.state, { paused: true }); // 停止中の予定を消費して捨てる
scheduler.sync(clock.state); // 復帰・読込等で現在位置へ同期。過去を発声させない
const state = scheduler.state; // 保持周期数・予定数・消費時刻等の読み取り専用情報

const samePlan = createBioCyclePlan(0, { seed: 0x42494f32 }); // 純粋な周期計画生成
```

入力は既存時計の完全なsnapshotを渡す。`elapsedSeconds`、`timeOfDay`と、境界の丸めを反映した
`cycleSeconds`を使う。共有`GAME_CLOCK_CONFIG`の180秒＋180秒を参照し、独自に時計を進めたり、
昼夜判定を再実装したりしない。別の昼夜長に設定したカスタム時計は対象外。

イベントは以下の読み取り専用情報を持つ。

| フィールド | 内容 |
|---|---|
| `eventId` | `bio-v1/<seedの8桁hex>/<cycleIndex>/<dayまたはnight>/<ordinal>` |
| `sourceId` | D-2B-1の6音源IDのいずれか |
| `scheduledSeconds` | 絶対ゲーム経過秒での予定開始時刻 |
| `latestStartSeconds` | 予定開始＋0.25秒。これより遅い開始は破棄する |
| `durationSeconds` | 原本manifestの音源長 |
| `phaseEndSeconds` | 該当する昼／夜が終了する絶対ゲーム経過秒 |
| `timeOfDay`、`cycleIndex` | 発声対象の時間帯と360秒周期番号 |

## 間隔・variantの選択

昼はbird-a/b/cを15〜30秒、夜はsuzumushi-a/b/cを8〜20秒の予定開始間隔で選ぶ。
最初の発声も時間帯の開始から同じ範囲の遅延を取る。間隔は1ms刻みで両端を含む。
時間帯内の予定開始間隔が対象であり、境界の前後は終了猶予と新時間帯の初期待機により余白が長くなる。

固定seed、周期番号の上下32bit、昼夜のsaltを整数演算で混合し、Mulberry32の決定的な系列を作る。
間隔とvariantには別の系列を使う。日・夜・周期ごとに変化し、同じseedと周期では完全に再現する。
フレーム更新のたびに乱数を引かない。seedは0〜0xffffffffの整数。

variantは3種類をシャッフルしたbagから順に取り出す。bagの先頭が直前と同じならbag内で入れ替える。
各時間帯内で同じIDは連続せず、各3発声で全variantを1回ずつ利用し、使用回数の差は最大1。
昼夜は異なるID群で、前の時間帯の残りbagや未発声予定を引き継がない。

発声予定＋時間帯内の最大音源長＋0.5秒が境界を超える場合、その予定以降は置かない。
0.5秒には許容する開始遅延0.25秒と、追加の境界余裕0.25秒を含む。
最大音源長より短いvariantでもこの共通余裕を保つ。
最短間隔8秒は最長音源4.1秒＋遅延0.25秒より長く、計画上は全体で重ならない。
`update`も1回に最大1イベントを返す。実際の発声中判定は再生側が持つ。

## 消費・停止・ジャンプ・保持範囲

初回`update`は現在位置へarmするだけでnullを返す。保存された途中時刻から過去を追い掛けない。
通常は前回の消費時刻より後〜現在までの、該当時間帯かつ開始期限内のイベントだけを返す。
同一snapshotの反復や微小な更新で同じイベントを返さない。

更新差が0.25秒を超えた場合、昼夜／周期が切り替わった場合、停止中と復帰直後はその時点までを捨てる。
長いジャンプは到達先の1周期だけを生成し、中間周期を走査したりまとめて発声したりしない。
0.25秒以内の通常更新では30／60／144fpsと不規則な更新で同じ予定を返す。
実際に受け取るフレーム時刻は異なるが、返却するID・予定時刻は同じ。
250ms超の低fpsや長いフレームでは意図的に発声を取りこぼす。

停止中にupdateを呼ばない構成では、復帰時に`sync(clock.state)`を呼ぶ。
純粋なゲーム時計入力だけから、実時間での一時停止を推測することはしない。
同一instanceを巻き戻しても消費済み時刻を下げないため、以前のイベントは再発声しない。
ゲーム時計をリセットして新しい再生履歴にする場合はschedulerを新規作成する。

保持するのは現在／最後に参照した1周期、最大32イベント（昼最大11＋夜最大21）とスカラーのcursorだけ。
イベントIDの履歴Setや過去周期のMapはない。`getPlan`で未来をプレビューしても発声cursorは進まない。
呼び出し側が過去の返却配列を保持し続ける場合は、そのメモリ管理は別途必要。
対応範囲は0以上`MAX_BIO_ELAPSED_SECONDS=9,007,199,254,440`秒未満。
大きな時間でも生成量は一定で、範囲外・非有限値・負値はRangeErrorで拒否する。
非常に大きな絶対時刻の小数精度はJavaScript Numberの精度に従う。

## 6分周期の予定サンプル

seed=`0x42494f32`、周期0（0〜360秒）。昼8件・夜12件。
イベントIDの共通prefixは`bio-v1/42494f32/0/`。例えば先頭は`bio-v1/42494f32/0/day/0`。

| ゲーム経過秒 | sourceId | 音源長・秒 |
|---:|---|---:|
| 15.960 | bird-b | 2.55 |
| 39.930 | bird-c | 2.85 |
| 64.217 | bird-a | 2.10 |
| 80.437 | bird-c | 2.85 |
| 96.742 | bird-a | 2.10 |
| 118.239 | bird-b | 2.55 |
| 133.535 | bird-a | 2.10 |
| 162.585 | bird-b | 2.55 |
| 189.551 | suzumushi-c | 3.85 |
| 205.103 | suzumushi-b | 4.10 |
| 224.641 | suzumushi-a | 3.60 |
| 242.151 | suzumushi-b | 4.10 |
| 253.097 | suzumushi-a | 3.60 |
| 263.481 | suzumushi-c | 3.85 |
| 276.990 | suzumushi-b | 4.10 |
| 290.145 | suzumushi-a | 3.60 |
| 299.770 | suzumushi-c | 3.85 |
| 311.134 | suzumushi-a | 3.60 |
| 327.237 | suzumushi-c | 3.85 |
| 343.951 | suzumushi-b | 4.10 |

## 検証とD-2B-3への引き継ぎ

`node --test --test-isolation=none tests/bio-schedule.test.js`で17項目を検証する。
複数seed・100周期の分類／間隔／均衡、3周期の30/60/144fps完全一致、境界、停止・復帰、
長いジャンプ、巻き戻し、10,000周期での保持上限、巨大な経過時間、禁止依存なしを含む。
最終結果は新規17項目成功、`npm test`全602項目成功（失敗・skip 0）、`npm run build`成功。
ビルドには既存three chunkの500kB警告がある。全単体ログは`test-results/bio-schedule-unit.log`へ保存し、コミットしない。
今回は未接続の純粋モジュールのため、ゲームの局所／全件E2Eは実行しない。
新規モジュールは現行L1許可表の対象外であり、局所成功をL1や全件検証成功とは扱わない。
既存factory・manifest・WAV・音声処理・時計・ゲームループ・既存テストは変更しない。

D-2B-3では返却IDからfactoryでbufferを取得する。取得中に停止・時刻変更・期限切れになった結果は捨てる。
再生直前に現在の共有時計・時間帯・停止理由・`latestStartSeconds`と終了可能幅を再確認する。
AudioBufferSourceを最大1件だけ所有し、実際に発声中なら新しいイベントを捨てる方針を決める。
すでに消費したイベントを再試行キューへ積まない。
昼夜・メニュー・非表示・フォーカス・context再生成への接続、音量・濃霧ミックス・途中停止フェードは次工程。
実音での密度・自然さ・通知との聞き分け、実機と長時間聴取は未確認である。
