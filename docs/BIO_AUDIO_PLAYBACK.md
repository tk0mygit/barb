# 生物環境音の再生統合（Phase 4.5-D-2B-3）

既存の共有AudioContext、音源factory、決定的スケジューラーを再利用して、昼の鳥・夜の鈴虫を再生する。
基準mainは`f54a5614f7a81e406e325ba1a27718e08e634aaf`、承認済みD-2B-1/2は
`880e6d442067336a8a183f4e0b3d385f3887aa8d` / `4c32559126dfdc159e9b78632699cb535244da85`。
着手時にoriginのmainと作業ブランチが一致することを確認した。

## 接続と責務

| ファイル | 責務 |
|---|---|
| `src/audio/bio-player.js` | 先読み、取得結果の所有、独立ワンショット、gain、停止と解放 |
| `src/audio/ambient-audio.js` | 既存の有効／停止／中断判定を両プレイヤーに通知。失敗を分離 |
| `src/audio/bio-sources.js` | 既存のWAV検証・取得・デコード・6件キャッシュ。変更なし |
| `src/audio/bio-schedule.js` | 既存の発声予定・重複排除・期限。変更なし |

`main.js`は変更せず、既存の`ambientAudio.update()`と`setPaused()`経由で接続する。
`ambient-player.js`の3ループ、`audio-mix.js`、`audio-session.js`、音声設定・保存、
6 WAVとmanifest、釣り状態と通知音は変更しない。
生物音失敗は環境音全体の`blocked`を立てず、BGM・風・水・アワセを継続する。
各公開操作と非同期処理は例外・rejectionを処理し、古い結果が新しい状態を書き換えない。

## 発声と音量

昼15〜30秒、夜8〜20秒、variantのbag選択・連続回避・昼夜境界の余裕は承認済みスケジューラーのまま。
フレーム更新でイベントを最大1件消費し、音源の準備完了後にも現在の共有時計と時間帯を再確認する。
予定開始＋0.25秒の期限と、音源が時間帯内で終了できることを確認してから発声する。
期限切れ・発声中・停止中のイベントはキューへ戻さない。

発声時だけ`AudioBufferSourceNode`とgainを1個ずつ作り、`loop=false`でdestinationへ接続する。
発声中またはフェード中の生物音は最大1件。イベントIDと予定開始時刻の消費位置も保持し、二重再生を防ぐ。
新しいAudioContext、JSタイマー、独自時計、乱数系統は作らない。

生物音の実効gainは以下。既存master定数0.3を再利用し、BGM側のgainは変更しない。

```text
voice gain 0.45 × AMBIENT_GAIN 0.3 × 設定音量/100 × 濃霧係数
昼・通常夜・通常霧: 濃霧係数=1
濃霧の夜: 濃霧係数=1 - 0.6 × 既存mix.intensity
```

既存`sampleAudioMix`が返す`fogType`と`intensity`だけを使用し、濃霧12秒フェードと同期する。
濃霧ピークは0.4倍、フェード中間は0.7倍で、完全無音にしない。
設定40%なら通常0.054、濃霧ピーク0.0216。100%なら0.135 / 0.054。
0.45と0.4倍は聴感確認用の候補値で、実機承認値ではない。
開始・音量・霧量変更・途中停止には40msの線形gainランプを用いる。
直前のランプから現在値を計算して再設定し、AudioParam.valueの既定値に依存しない。
自然終了の末尾は納品PCMの無音端点を保つ。

## 先読みと再試行

設定ON・音量正・正規unlock済み・context runningで現在の3種類を非同期に取得する。
メニュー表示中も準備できるが、ロード完了だけでは発声しない。
時間帯終了30秒前から次の3種類も準備し、最大6種類を保持する。
通常フレームでfetch/decodeを同期的に待たず、ready/loadingのIDは再取得しない。
同じAudioBufferをfactoryのPromiseとready Mapから参照し、PCMをコピーしない。

取得・デコード・factory生成が失敗したIDは15ゲーム秒待って再取得する。
時計が止まるメニューでは自動再取得を連打しない。context再開や環境音全体の再試行時はこの待機をリセットする。
既にreadyのsessionへの通常操作は待機をリセットしない。通常操作100回でも失敗した3音源の取得は初回3回に留まることを検証した。
失敗時にもBGM側の再生状態や通知経路は変更しない。

通常メニュー・音量0・一時中断ではキャッシュを再利用する。メニュー中の先読み完了はキャッシュへの保存だけを許す。
OFF・context closed/交換・最終disposeではfactoryをdisposeし、取得をabort、ready/loading/retryの参照を外す。
中断できない旧decodeが後から完了しても、bankの世代と参照の一致を確認して捨てる。
停止した発声待ちPromiseは別の再生世代で無効化し、キャッシュ完成を自動発声につなげない。

## 停止と解放

OFF、音量0、メニュー、blur、hidden、pagehideは既存controllerの停止理由をそのまま適用する。
復帰・昼夜切替・時間ジャンプではschedulerを現在のゲーム時計へsyncして過去分を捨てる。
contextのsuspended/interrupted/closedも所有中のstatechangeで停止し、resumeは既存sessionのユーザー操作だけに任せる。

running中の途中停止は40ms fadeとsource.stopのAudioContext時刻予約を使い、onendedで
source/gainをdisconnect、bufferとonendedをnullへ戻す。フェード中も新たなvoiceを作らない。
既に中断／closedのcontextは即時切り離す。最終disposeのフェード中にcontextが閉じてもstatechangeで解放する。
context listenerはfactoryもvoiceもなくなった段階で解除する。
WebGL喪失と初期化失敗時の既存dispose経路にも接続される。
context自体を閉じる瞬間のハード出力は、OfflineAudioContextによるフェード検証の対象外。

## 保持量と長いフレーム

生物音の接続中ノードは最大2個。既存3ループの7ノードと合わせて最大9個、通知の2ノードは別経路。
生物音のFloat32 payloadは全6本で44.1kHz: 3,360,420 bytes、48kHz: 3,657,600 bytes。
既存PCM3本6,350,400 bytesと合わせて44.1kHz時9,710,820 bytes、48kHz時10,008,000 bytes。
デコーダー内部、JSメタデータ、GC待ち領域、HTTP cacheはこのpayload値に含めない。
取得中のOFF/ON連打では、停止できない旧decodeが一時的に重なる可能性がある。
スケジューラーの保持は1周期・最大32イベントで、再生履歴の無制限なSetや配列を作らない。

30分相当・250ms刻みの単体シミュレーションでは95発声・95解放、最大2ノード、
最大3,360,420 bytes、factory.getは6回だった。その後の1秒更新10回は10回を長いフレームとして数え、発声を増やさなかった。
これは実機の30分連続動作や物理ヒープ測定ではない。
250ms超が続く端末では発声が欠落する。今回期限は緩めず、実機でフレーム間隔・取りこぼしを確認する。
改善候補はデコード先読みのタイミングや既存同期処理の負荷評価であり、期限変更は別判断とする。

## 検証と聴取

基本検証は`npm ci`（この環境は`--cache /workspace/.npm-cache`）、`npm test`、`npm run build`。
新規単体は`tests/bio-player.test.js`。先読み・期限・停止中のロード・再試行・世代・partial allocation・gain・30分を含む。
`tests/browser/audio-fixture.js`ではループと生物音のsourceを区別する。
既存3ループの件数・gain・24秒・offsetのassertionを維持し、生物音は別の件数とIDで検証する。
gain件数から除外するのは、生物音sourceに接続されたgainと証明できるものだけで、未分類の漏れは数に残す。
D-2B-1の「未接続なのでビルドにWAVなし」という段階限定テストは、6 WAVの出力と原本SHA一致の検証へ更新した。

音響・共通スモークの局所選択は次の7 spec。昼夜・濃霧は境界ケースだけを追加で選択する。

```bash
npx playwright test tests/browser/audio.spec.js tests/browser/audio-gain.spec.js \
  tests/browser/bio-audio.spec.js tests/browser/bio-audio-quality.spec.js \
  tests/browser/bio-sources.spec.js tests/browser/smoke-pc.spec.js tests/browser/smoke-touch.spec.js
npx playwright test tests/browser/day-night.spec.js tests/browser/night-fog.spec.js \
  --grep 'lighting crosses both clock boundaries|fog fades at both boundaries'
```

結果JSONと失敗時Traceは`test-results/bio-reviewed-audio*`と`test-results/bio-reviewed-boundaries*`等に保存し、生成物をコミットしない。
最終の音響・共通スモークは7 spec・43件、昼夜／濃霧境界は2 specの2件で、計45件成功。
両選択とも失敗・skip・flakyは0、各テスト1試行。ローカル全件E2Eは実行していない。
新規E2Eの開発中に、仮想時計の長いjumpで発生する40ms fade完了前の観測、OFF再取得後の累積decode数、
未表示UIの状態文字列、非表示の釣りボタンへの操作、IEEE -0と振幅0の比較を修正した。
初回の診断は`test-results/bio-audio-initial`、`bio-quality-initial`、`bio-audio-core`、`bio-audio-lifecycle`へ残した。
タイムアウト延長、force操作、既存assertion削除、CI分類変更は行わない。

native品質検証は実コードの独立経路をOfflineAudioContextへ接続し、原本WAVと既存3 PCM、通知音を音量100%で30秒renderする。
昼・通常夜・濃霧のWAV/数値JSONを出力する。試聴ファイルだけは両端に80msフェードを加える。
固定長の試聴ファイルは、最後の鳴き句の途中で終わる場合がある。原本素材は加工しない。
出力全体の隣接サンプル差には高周波の正常な振動を含むため、クリック判定の単独根拠にしない。
gainの開始・途中音量変更・途中停止は別の定数PCM検証で数値不連続を調べる。

48kHz・各30秒・音量100%・7.2秒付近に従来通知を1回重ねたnative測定:

| 条件 | peak | RMS | clip sample | 最大隣接差 |
|---|---:|---:|---:|---:|
| 昼 | 0.146722 | 0.0100883 | 0 | 0.0256158 |
| 通常夜 | 0.136719 | 0.00880444 | 0 | 0.0148231 |
| 濃霧 | 0.124836 | 0.00698276 | 0 | 0.0163733 |

各条件でループsource最大3、生物source最大1。dispose後の接続source・生物PCM参照は0で、buffer/onendedも解除した。
定数PCMの開始・途中音量変更・途中停止では最大隣接差0.0000703707、停止完了後は厳密に0。
この定数PCMの結果はgainの数値連続性であり、実機のクリックや聴感の保証ではない。
`npm ci`・`npm test`620件（新規player 18件を含む）・`npm run build`は成功。
ビルドの既存three chunk 500kB警告は残る。B-1/2のWAV・manifest・factory・schedulerの差分はなく、原本SHAも再確認した。

PCとスマホ縦横はChromiumのviewport/touchエミュレーション。OS音声出力、実機Chrome/Brave/LINE/Safari、
着信・ロック・長時間の疲労・通知との聴感上の聞き分けは未確認。
実機では低めの端末音量から、鳥が笛のように聞こえないか、鈴虫の高域と反復が疲れないか、
濃霧40%が小さすぎないか、ON/OFF・割込み復帰が自然かをPM／ユーザーが確認する。
PRは共有音声制御と新規ファイルを含むL2。ローカル全件E2Eは実施せず、PR作成後のCIはPMが判断する。
