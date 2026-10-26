# 生物環境音の音源管理（Phase 4.5-D-2B-1）

対象はユーザー指定のD-2A納品WAV6本の配置・取得・検証・デコード・キャッシュ・解放。
昼夜の発声スケジュール、乱数、再生ノード、ゲーム本体への接続は実装していない。
基準mainは着手時にoriginから取得した `f54a5614f7a81e406e325ba1a27718e08e634aaf`。
作業ブランチは `feat/phase-4.5-d2-bio-audio`。

## 原本と配置

既存ファイルを使用し、合成・再エンコード・音量変更を行わずバイト列をコピーした。

| 原本 | 確認した所在 |
|---|---|
| 納品ZIP | `/workspace/BARB_Phase_4_5_D_2A_audio.zip` |
| ZIPハッシュ控え | `/workspace/BARB_Phase_4_5_D_2A_audio.zip.sha256` |
| 展開済みmanifest | `/workspace/barb-d2a-audio/manifest.json` |
| 展開済み6音源 | `/workspace/barb-d2a-audio/wav/{bird,suzumushi}-{a,b,c}.wav` |
| 引き継ぎ原本 | `/workspace/barb-d2a-audio/HANDOFF_D2B.md` |

ZIPは11,852,206 bytes・39エントリ。CRC、重複名なし、ZIP内外のmanifestと6 WAVのバイト一致、
展開済みパックの全`SHA256SUMS.txt`を検証した。

```text
ZIP SHA-256:
84519a9562b7374aa0ae94cf2d8e835b065f093ceafaf7215b9d21f8ed797b25
manifest.json SHA-256:
11b7fb680dcf8239df7d445d886455288054893ca634bc9c61156912dee67ae4
```

リポジトリ内は `src/assets/audio/bio/manifest.json` と `src/assets/audio/bio/wav/`。
manifestも原本のまま保持し、実装はその`variants`6件だけを利用する。
manifestの`previews`が指す参考ミックス5本は本番素材にコピーしていない。
`status`等の記述はD-2A制作時点の記録を保存したもので、今回の採用対象はユーザーのD-2B-1指示に従う。
今回、新しい聴感評価は行わない。

| ID | 秒 | フレーム | WAV bytes | SHA-256 |
|---|---:|---:|---:|---|
| bird-a | 2.10 | 92,610 | 185,264 | `f4fe58dcc944ed86b75fc752bc9a276e2114231a19aace1f35c4f6801df75cdd` |
| bird-b | 2.55 | 112,455 | 224,954 | `b5f70daa5f51bd980758f3516859b642e05bb84027186dc8a1c8f471267cbd07` |
| bird-c | 2.85 | 125,685 | 251,414 | `4d1a4a0ae8335dad212d19352035784513fe98e82f8517eab863c114ea465224` |
| suzumushi-a | 3.60 | 158,760 | 317,564 | `08894eafb5aada31fa37f8f30a95674052f6150376ab138f059a5f83c4fd3e49` |
| suzumushi-b | 4.10 | 180,810 | 361,664 | `3461114f02ba6af205c3b3bf91e19e131422fb536fa74b8aeae5f929cc631224` |
| suzumushi-c | 3.85 | 169,785 | 339,614 | `ab91099ba8c898b3f3cc7a2e187b4e3dd72a4a5114b9d2ead02aa93f4002c953` |

全てRIFF/WAVE・44,100Hz・mono・PCM16・各1回の鳴き句。ID集合、形式、長さ、サンプル数、容量、SHAが一致した。
`scripts/verify-bio-assets.mjs`で原本manifestのハッシュ固定、6 WAVのSHAと形式を再検証できる。

## モジュールとAPI

| ファイル | 責務 |
|---|---|
| `src/audio/bio-source-assets.js` | 読み取り専用カタログと固定ID→URL |
| `src/audio/bio-source-validation.js` | manifest・RIFF/PCM16・デコード結果の検証 |
| `src/audio/bio-sources.js` | 独立したfactory。取得とキャッシュの所有 |

```js
import { createBioSourceFactory } from './audio/bio-sources.js';

const factory = createBioSourceFactory(existingContext);
const variants = factory.variants; // 凍結された6件のメタデータ
const pending = factory.get('bird-a'); // Promise<AudioBuffer>
const samePending = factory.get('bird-a'); // pending === samePending
const buffer = await pending;
factory.clear();   // 取得中を破棄・キャッシュを解放し、再取得は可能
factory.dispose(); // 恒久破棄。以後get()はInvalidStateErrorでreject
```

`context`は呼び出し側から供給し、`decodeAudioData`と正の有限`sampleRate`が必要。
factoryはcontextを生成・unlock・resume・closeしない。AudioBufferSource、gain、タイマーも作らない。
オプションはテスト等で取得関数を差し替える`{ fetcher }`のみ。既定は`globalThis.fetch`。
IDとURLの上書き機能はない。6本のURLは静的な`new URL(…, import.meta.url)`でViteに検出させ、
`/barb/`配下のハッシュ付きアセットURLへ変換する。

現在は既存モジュールからfactoryをimportしない。通常のゲームビルドにはfactoryも新しいWAVも出力されない。
将来の呼び出し側からimportすればViteが6本を配置することを、独立した検証用ビルドで確認する。

## 取得・検証・キャッシュの契約

`get(id)`はasync関数のラップを介さず、同じIDの同時要求と完了後の取得に同一のPromiseを返す。
解決値のAudioBufferも共有する。異なるIDは別のPromise・取得・デコードを持つ。
IDは6件のMapで判定し、不正IDや`__proto__`等を取得前にrejectする。

取得成功後、WAVのRIFFサイズ、チャンク境界とpadding、fmt/dataの重複・順序、PCM形式、
サンプルレート・チャンネル・ビット深度・byte rate・block align・フレーム・長さ・容量を検査する。
続いてWeb CryptoでSHA-256を照合してからdecodeする。正しいヘッダーのサンプル改変や別IDへの取り違えも拒否する。
HTTPSのGitHub Pagesとlocalhostのsecure contextを想定する。

デコード後はmono、contextのsample rate、長さ（リサンプル時の丸め1フレーム以内）、
Float32のサンプル数と有限値を検査する。
HTTP、通信、body取得、ハッシュ、デコード、受入検証のいずれの失敗もrejectし、キャッシュから除く。
次回の`get`は新しく取得する。同じ失敗を成功値や無音バッファへ置き換えない。

| 操作 | 既存キャッシュ | 進行中の要求 | 次のget |
|---|---|---|---|
| `clear()` | factoryの参照を削除 | AbortControllerをabortし、PromiseをAbortErrorで速やかにreject | 再取得可能 |
| `dispose()` | 同上 | 同上 | 恒久的にInvalidStateErrorでreject |

各要求がAbortControllerを所有する。正常完了後はcancel関数を外し、失敗時はabortして解放する。
clear/disposeは先にMapから世代のエントリを除き、古い成功・失敗が新しいエントリを復活・削除しないよう
各awaitの後でエントリ同一性を確認する。
`decodeAudioData`自体は中断できないので、clear/dispose後にその内部処理が完了しても結果を採用しない。
disposeはfactoryが持つcontext/fetcher参照も外す。共有contextを閉じる責務は持たない。

## メモリの概算

| 保持データ | 概算 |
|---|---:|
| WAV6本のファイル容量合計 | 1,680,474 bytes（1.603MiB） |
| 44.1kHzでデコードしたFloat32全6本 | 3,360,420 bytes（3.205MiB） |
| 48kHzでデコードしたFloat32全6本 | 3,657,600 bytes（3.488MiB） |

Float32本体は`buffer.length × buffer.numberOfChannels × 4`。全6本の総時間は19.05秒。
平常時、factoryはデコード済みバッファを解決値とする最大6件のPromiseを保持し、生WAVは別途キャッシュしない。
正しい6素材を同時取得した場合のencoded+decodedの単純和は44.1kHzで約4.807MiB、48kHzで約5.091MiB。
JSメタデータ、ネットワークキャッシュ、デコーダー内部のコピー、GC待ち領域を含む実プロセスの上限値ではない。
clear直後の再取得中には、中断できない旧decodeと一時的に重なる場合がある。
呼び出し側や将来の再生ノードがbufferを保持すれば、clear/disposeだけでそのメモリを強制解放できない。

## 検証

```bash
npm ci
# このクラウド環境の既定npmキャッシュが書き込めない場合:
# npm ci --cache /workspace/.npm-cache
node scripts/verify-bio-assets.mjs
node --test --test-isolation=none tests/bio-assets.test.js tests/bio-sources.test.js
npm test
npm run build
npx playwright test tests/browser/bio-sources.spec.js tests/browser/smoke-pc.spec.js tests/browser/smoke-touch.spec.js --list
npx playwright test tests/browser/bio-sources.spec.js tests/browser/smoke-pc.spec.js tests/browser/smoke-touch.spec.js --reporter=line
```

クラウドのChromiumを使う場合は`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`を付ける。
局所単体テストは20項目。破損WAV、SHA不一致、失敗・再試行、Promise共有、ID独立、
clear/dispose中の遅延成功・失敗、無使用時の副作用なしを含む。
ブラウザは実際にViteで別ビルドし、生成されたWAVのSHA、`/barb/` URL、44.1/48kHzのnative decodeとメモリを検証する。
共通fixtureの診断と失敗時Traceを維持し、共有テスト設定は変更しない。

2026-10-26の最終結果:

| 検証 | 結果 |
|---|---|
| `npm ci --cache /workspace/.npm-cache` | 成功・21 packages。lockfile変更なし |
| 原本manifest＋6 WAV検証 | 全件一致。原本ZIP内外とリポジトリ配置のバイト一致も再確認 |
| 音源の局所単体テスト | 20件成功・失敗0・skip0 |
| `npm test` | 585件成功・失敗0・skip0 |
| `npm run build` | 成功。既存three chunkの500kB警告あり |
| 局所Playwright収集 | 3 spec・4テスト |
| 局所Playwright実行 | 4件成功・失敗0・skip0・flaky0。各1試行 |
| native AudioBuffer本体 | 44.1kHz: 3,360,420 bytes / 48kHz: 3,657,600 bytes |
| 保護対象・依存・設定の差分 | なし |

全単体ログは`test-results/bio-sources-unit.log`、局所ブラウザ結果は
`test-results/bio-sources-browser.json`、nativeの数値は同出力ディレクトリ内の
`native-bio-sources.json`に保存する。これらの実行生成物はコミットしない。

初回`npm ci`は既定`/home/agent/.npm/_cacache`へ書き込めずENOENTとなった。
書き込み可能な既存cacheを指定して修正した。
初回の全単体実行は既存のCI検証用テスト2ファイルで`spawnSync git EPERM`、
既存の景観比較テストで履歴SHA `eb10aa13ec302a7a4c9b4a421a596f447c8f6e7c`不足により失敗した。
該当履歴をoriginから取得し、子プロセスを実行できる権限で該当67テストを確認後、
同じ全単体を再実行して585件成功を確認した。テストの削除・条件緩和・タイムアウト延長はない。
既存CI検証用の単体テストが動かす一時fixtureのprobeは、BARB本体の全件E2EやリモートCIではない。

新しい音源・モジュール・specは現行L1許可表の対象外であり、将来のPR分類はL2となる。
本工程はユーザー指定に従い、ローカル全件E2E、PR、CI実行・監視、マージ、デプロイを行わない。
局所成功を全件E2E成功とは扱わない。

## D-2B-2への引き継ぎ

既存の`audio-mix.js`、3種類の24秒PCM、`ambient-player.js`、BGM、風・水、アタリ音、
unlock、音声設定・保存形式、`src/main.js`には変更を加えていない。

次工程が共有contextを供給し、必要な音源だけ`get`して利用する。contextを作り直す場合はfactoryも新しくする。
再生・ノード所有・途中停止のフェード・通知との重なり・昼夜判定・選択・間隔・同時発声数は次工程の責務。
既存playerの3本ループ用`makeBuffers`へこの非ループ素材を渡さない。
`clear()`をメニュー停止ごとに使うかキャッシュを保つか、OFFやcontext破棄時にどこでdisposeするかも次工程で接続する。
取得PromiseのAbortErrorを扱い、停止後の非同期完了から発声を始めないようにする。

音量案や固定配置の試聴ミックスは今回の実装に取り込んでいない。
ゲーム上での聞こえ方、実時間の負荷、スマートフォン実機、他ブラウザ、長時間聴取、
発声スケジュールとライフサイクルの統合は未確認である。
