# 生物環境音の再生統合とフェード（Phase 4.5-D-2B-3 / D-3）

既存の共有AudioContext、音源factory、決定的スケジューラーを再利用して、昼の鳥・夜の鈴虫を再生する。
基準mainは`f54a5614f7a81e406e325ba1a27718e08e634aaf`、承認済みD-2B-1/2は
`880e6d442067336a8a183f4e0b3d385f3887aa8d` / `4c32559126dfdc159e9b78632699cb535244da85`。
着手時にoriginのmainと作業ブランチが一致することを確認した。
D-3はorigin/main `7f76b5a9b917dc0cdd87d8150dd2f5ddacd932e8`を再確認し、
`fix/phase-4.5-d3-bio-fade-volume`から音量と鈴虫の自然な発声エンベロープだけを調整した。

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

発声時だけ`AudioBufferSourceNode`を作り、`loop=false`で接続する。
鳥は従来どおり`source → Voice Gain → destination`、
鈴虫は`source → Envelope Gain → Voice Gain → destination`とする。
発声中またはフェード中の生物音は最大1件。イベントIDと予定開始時刻の消費位置も保持し、二重再生を防ぐ。
新しいAudioContext、JSタイマー、独自時計、乱数系統は作らない。

生物音の実効gainは以下。既存master定数0.3を再利用し、BGM側のgainは変更しない。

```text
voice gain 0.36 × AMBIENT_GAIN 0.3 × 設定音量/100 × 濃霧係数
昼・通常夜・通常霧: 濃霧係数=1
濃霧の夜: 濃霧係数=1 - 0.6 × 既存mix.intensity
```

既存`sampleAudioMix`が返す`fogType`と`intensity`だけを使用し、濃霧12秒フェードと同期する。
濃霧ピークは0.4倍、フェード中間は0.7倍で、完全無音にしない。
設定40%なら通常0.0432、濃霧ピーク0.01728。100%なら0.108 / 0.0432。
D-3でvoiceを0.45から0.36へ20%（約-1.94dB）下げた。濃霧の0.4倍は維持する。
これらは時間的エンベロープ前の最大gainであり、実機聴感の承認済みとは扱わない。
開始・音量・霧量変更・途中停止には40msの線形gainランプを用いる。
直前のランプから現在値を計算して再設定し、AudioParam.valueの既定値に依存しない。
鳥の開始・自然終了タイミングは変えず、PCMも加工しない。

鈴虫3種類だけは、再生開始のAudioContext時刻に滑らかなsmoothstepカーブを一度予約する。
開始から0.5秒で0→1、その後1を保ち、実際の`AudioBuffer.duration`の終わり0.75秒前から1→0とする。
原本の長さ3.6 / 4.1 / 3.85秒なら、フェードアウト開始は2.85 / 3.35 / 3.10秒。
129点ずつの制御点を`setValueCurveAtTime`へ渡してAudioParam側で補間する。JSタイマーは使用しない。
Envelope Gainは音量・濃霧・毎フレームの更新で再予約しない。Voice Gainの40msランプは従来どおり独立して動作する。
強制停止ではVoice Gainを40msで0へ下げ、0.75秒の自然終了を待たずsourceを止める。

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
source/Envelope Gain/Voice Gainをdisconnect、bufferとonendedをnullへ戻す。フェード中も新たなvoiceを作らない。
Envelope Gainの生成・接続・カーブ予約に失敗した途中段階でも、確保済みノードを同じ解放経路へ渡す。
既に中断／closedのcontextは即時切り離す。最終disposeのフェード中にcontextが閉じてもstatechangeで解放する。
context listenerはfactoryもvoiceもなくなった段階で解除する。
WebGL喪失と初期化失敗時の既存dispose経路にも接続される。
context自体を閉じる瞬間のハード出力は、OfflineAudioContextによるフェード検証の対象外。

## 保持量と長いフレーム

生物音の接続中ノードは鳥2個、鈴虫3個。既存3ループの7ノードと合わせて最大10個、通知の2ノードは別経路。
追加は発声中の鈴虫1件につきGainNode 1個のみ。共有のFloat32制御点は2×129×4 = 1,032 bytes。
Web Audio内部のコピー・ノード実装の領域は別で、ブラウザー総heapの増分は未測定。
予約呼び出しは鈴虫1発声に2回で、毎フレームのカーブ計算・予約やPCM複製は増やさない。実機CPU増分は未測定。
生物音のFloat32 payloadは全6本で44.1kHz: 3,360,420 bytes、48kHz: 3,657,600 bytes。
既存PCM3本6,350,400 bytesと合わせて44.1kHz時9,710,820 bytes、48kHz時10,008,000 bytes。
デコーダー内部、JSメタデータ、GC待ち領域、HTTP cacheはこのpayload値に含めない。
取得中のOFF/ON連打では、停止できない旧decodeが一時的に重なる可能性がある。
スケジューラーの保持は1周期・最大32イベントで、再生履歴の無制限なSetや配列を作らない。

30分相当・250ms刻みの単体シミュレーションではD-3も95発声・95解放、最大3ノード、
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
D-2B-3時点の音響・共通スモークは7 spec・43件、昼夜／濃霧境界は2 specの2件で、計45件成功。
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

D-2B-3時点（旧gain 0.45、鈴虫の自然エンベロープ追加前）の48kHz・各30秒・
音量100%・7.2秒付近に従来通知を1回重ねたnative測定:

| 条件 | peak | RMS | clip sample | 最大隣接差 |
|---|---:|---:|---:|---:|
| 昼 | 0.146722 | 0.0100883 | 0 | 0.0256158 |
| 通常夜 | 0.136719 | 0.00880444 | 0 | 0.0148231 |
| 濃霧 | 0.124836 | 0.00698276 | 0 | 0.0163733 |

各条件でループsource最大3、生物source最大1。dispose後の接続source・生物PCM参照は0で、buffer/onendedも解除した。
定数PCMの開始・途中音量変更・途中停止では最大隣接差0.0000703707、停止完了後は厳密に0。
この定数PCMの結果はgainの数値連続性であり、実機のクリックや聴感の保証ではない。
D-2B-3時点の`npm ci`・`npm test`620件（新規player 18件を含む）・`npm run build`は成功。
ビルドの既存three chunk 500kB警告は残る。B-1/2のWAV・manifest・factory・schedulerの差分はなく、原本SHAも再確認した。

PCとスマホ縦横はChromiumのviewport/touchエミュレーション。OS音声出力、実機Chrome/Brave/LINE/Safari、
着信・ロック・長時間の疲労・通知との聴感上の聞き分けは未確認。
実機では低めの端末音量から、鳥が笛のように聞こえないか、鈴虫の高域と反復が疲れないか、
濃霧40%が小さすぎないか、ON/OFF・割込み復帰が自然かをPM／ユーザーが確認する。
PRは共有音声制御と新規ファイルを含むL2。ローカル全件E2Eは実施せず、PR作成後のCIはPMが判断する。

## D-3の検証条件

単体では鈴虫3種類の実デコード長に従う予約、鳥の従来経路、音量・霧変更時の予約不変、
attack/sustain/release中の40ms強制停止、source/gain/envelopeの部分生成・接続・予約失敗の解放を検証する。
30分相当の検証も最大ノード数を3へ更新し、PCM容量・取得回数・95発声/解放の条件は維持した。

nativeの原本WAV検証は48kHz、設定100%、通常夜（最大voice gain 0.108）。
AudioContext時刻0から実際のplayerを通して鳴らし、連続関数のsmoothstepに対するサンプル誤差1e-6未満、
attack/releaseの振幅比の誤差5e-5未満、sustainの振幅比1、clip 0、自然終了後0、全ノード解放を要求する。
鈴虫の試聴WAVは元のAudioBuffer全長をPCM16へ出力し、追加のファイル端フェードを掛けない。
別途、鳥と鈴虫の定数PCMで音量変更・attack途中停止の段差と40msランプ後の無音を測る。
旧来の3ループへの厳密な件数検証に加え、再生中の生物音は鳥2/鈴虫3ノード、
終了後は既存7ノードへ戻ることを検証する。未分類のgainは除外しない。

この環境のPlaywright既定ブラウザーは未配置だったため、既存の
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`（Chromium 154）を使用する。
初回の起動失敗は`test-results/d3-quality*`に保持した。
65制御点のnative検証では連続smoothstepとの振幅比誤差が約5e-5〜1.2e-4だったため、
制御点を129へ増やした。振幅比の閾値は維持し、サンプル誤差の条件は1e-5から1e-6へ厳しくした。
初期の数値・WAV・失敗Traceは`test-results/d3-quality-native*`に保持している。

129点での実WAV測定（48kHz、音量100%、通常夜）:

| 鈴虫 | 実duration | release開始 | peak | 連続smoothstepとの最大サンプル誤差 |
|---|---:|---:|---:|---:|
| a | 3.60秒 | 2.85秒 | 0.0158967 | 4.275e-7 |
| b | 4.10秒 | 3.35秒 | 0.0145807 | 4.897e-7 |
| c | 3.85秒 | 3.10秒 | 0.0142586 | 3.921e-7 |

3種類ともclip 0、sustain振幅比は約1、自然終了後0、全3ノードdisconnect、buffer/onended解除。
原本にも余韻・静かな末尾があるため、release区間のPCM加重RMS比はa約0.957、b約0.975、c約0.999となる。
時間的gainの0→1→0は同じ仕様で予約するが、聴感上の変化量は原本の発声位置にも依存する。
定数PCMの強制停止では最大隣接差は鳥5.626e-5、鈴虫1.870e-6、停止後は0だった。

D-3の既存3ループ＋生物音＋通知1回（48kHz、各30秒、設定100%）:

| 条件 | peak | RMS | clip sample |
|---|---:|---:|---:|
| 昼 | 0.144302 | 0.00997586 | 0 |
| 通常夜 | 0.136719 | 0.00861246 | 0 |
| 濃霧夜 | 0.124836 | 0.00695714 | 0 |

20%低下の対象は生物音だけなので、混合出力全体のpeakが20%下がることは要求しない。
既存BGM・自然音・通知音は同じgainで継続する。各条件のsource上限は既存ループ3／生物音1、
dispose後の接続source・生物PCMは0、buffer/onendedを解除した。

D-3最終検証は`npm ci --cache /workspace/.npm-cache`、`npm test`625件、`npm run build`が成功。
上記7 specの局所E2Eは47件成功（8.4分）、全件1試行、retry/skip/flaky/失敗0。
結果は`test-results/d3-reviewed-audio.json`、集計は`d3-validation-summary.json`、
単体ログは`d3-final-unit.log`、ビルドログは`d3-build.log`に保存した。
原本6 WAVのビルド出力SHA一致、既存3ループ、通知、PC・タッチ縦横、停止・復帰・失敗分離も含む。
既存CI分類器へmainからの8ファイル差分を渡し、L2・29 specの計画となった。
最初の理由は未登録文書`docs/BIO_AUDIO_PLAYBACK.md`で、音響コンポーネントと共通fixtureも変更対象。
分類器・workflowは変更せず、ローカル全件E2EとCI完了待機・監視は行わない。
実機のCPU・総heap・聴感と、Safari等の動作は引き続きPM／ユーザーの確認事項。
