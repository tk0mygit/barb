# BITE通知音 — Phase 4.5-E-1

暫定音源／後日差し替え可能／ユーザー実機聴感未承認。
自動検証の成功をPhase E全体の聴感受入・最終完了とは扱わない。

## 生成元と利用条件

- 音源: ユーザーがAdobe Fireflyの効果音生成機能で生成し、waterdrop.wavとして提供したWAV。
- 来歴確認日: 2026-10-27。ユーザーはテキストのみで生成し、外部の参考音声を使っていないと回答した。
- モデル名・バージョン、プロンプト全文、生成日時: 未共有。モデル名を推定していない。
- 元の添付実ファイル名: 1-waterdrop.wav。収録先: src/assets/audio/bite/waterdrop.wav。
- Adobe公式は効果音のゲームへの組み込みと、条件を満たすFirefly出力の商用利用を案内する。
  一般的な利用条件の確認と、上記のユーザー申告による今回のファイルの来歴確認は分けて記録する。
- コードのライセンスを音源に自動適用しない。CC0／MIT等への読み替え、
  生成物の著作権成立・独占権・第三者への全面再許諾を保証する表示はしない。
- Adobeの生成AIユーザーガイドラインに従い、第三者権利を侵害する入力・出力を利用しない。
  添付に含まれるAdobeの来歴参照付きXMPチャンクも、そのまま保持して配信する。
  外部manifestの暗号署名やユーザーの生成アカウントまでは独立検証していない。

2026-10-27に確認した公式資料:

- [Adobe Firefly効果音生成](https://www.adobe.com/products/firefly/features/sound-effect-generator)
- [Adobe Firefly FAQ](https://helpx.adobe.com/jp/firefly/web/get-started/learn-the-basics/adobe-firefly-faq.html)
- [Adobe Generative AI User Guidelines](https://www.adobe.com/legal/licenses-terms/adobe-gen-ai-user-guidelines.html)

## 原本・収録アセット・再生処理

原本と収録WAVはバイト単位で同一。ファイルのトリム、再エンコード、正規化、メタデータ削除は行わない。
加工後の別ファイルは作らず、先頭スキップ・gain・微小フェードをWeb Audioの再生時に適用する。

| 項目 | 原本／収録WAV |
| --- | --- |
| 形式 | RIFF WAVE、PCM signed 16-bit little-endian |
| サンプルレート・チャンネル | 48,000 Hz、stereo |
| フレーム・時間 | 48,000 / channel、1.000000秒 |
| 容量 | 192,770 bytes（PCM data 192,000 bytes、XMP等を含む） |
| sample peak | 0.984375、−0.136788 dBFS |
| 全体RMS | 0.0335087067、−29.496847 dBFS |
| クリップサンプル・非有限値 | 0・0 |
| 先頭で−60dBFSを超える位置 | 21.3125ms |
| 主ピーク位置 | 39.0625ms |
| SHA-256（原本・収録共通） | bf4b486ec972012fb5d6529b91f3586451245c0dae2ec25f3ca6b65e7db998ad |

37〜682ms付近に複数のピークがあり、その後に低い減衰尾部がある。
知覚上の水滴の自然さ・発音数は機械計測だけで確定しない。ファイルを1回だけ再生し、loopしない。

再生時は先頭20msをスキップし、残り0.98秒をgain 0.2、開始1ms／終了5msの線形フェードで再生する。
旧電子音のgain・0.32秒を流用した設定ではない。
48kHzのPCMと同じエンベロープによる参照計算はpeak 0.196875（−14.116189dBFS）、
0.98秒のRMS 0.0067697794（−43.388510dBFS）。
出力が−40dBFSを初めて超えるのは再生開始から17.375ms。これは音量しきい値による波形計測で、可聴遅延の保証ではない。

Viteは単一の収録WAVから /barb/assets/waterdrop-DUyVnZBm.wav を生成する。
追加音源容量は192,770 bytes。distも原本と同じSHAで、素材サイトへの直リンクは使わない。

## 事前準備と状態からの独立

createFishingAudio({ session }) と bite() の境界を維持する。
生成時に取得を開始し、既存のユーザー操作で共有AudioSessionがreadyになってからdecodeする。
新しいAudioContextや自動unlock、JavaScriptタイマー、ゲーム時計は追加しない。
preload()は準備の完了を観測できるが、contextを生成・resumeしない。

bite()は同期処理で、準備済みのPCMからsourceとgainだけを作り、現在のAudioContext時刻に再生を予約する。
取得・decode・Promise完了を待たない。準備待ち・非対応・拒否・取得／decode失敗では、その通知だけを省略する。
後から準備が完了しても過去のBITEは再生しない。
取得失敗後は次のreadyへの遷移、明示的なunlock、またはページ再読込で再試行できる。
BITE発火自体を取得・再試行の起点にしない。

main.jsのPHASE.BITEへの遷移時に1回だけ呼ぶ箇所、hookWindow=1秒、アワセ・HUD・釣り状態・抽選・セーブは変更しない。
音声の終了前でもFIGHTへ進め、釣りの成功・失敗は音声の状態を参照しない。
通知は環境音masterを通さず、BGM／自然音／鳥・鈴虫のON/OFF・音量から独立する。
旧電子音のフォールバックはない。

## 保持数と解放

- 圧縮データは取得中の1件、またはdecodeへ渡す前の1個だけ。decodeAudioDataにはコピーせず渡す。
- decoded PCMは1個。48kHz stereoで384,000 bytes、44.1kHzでは352,800 bytes。
  Chromiumの44.1kHz変換は1フレーム短い44,099フレーム・352,792 bytesを実測した。
  検証するsampleRateの上限192kHzでは最大1,536,016 bytes（2フレームの長さ誤差を許容）。取得データは256KiBで上限検査する。
- decode中のjobも1個だけ。閉鎖・世代変更・dispose後の結果は破棄し、
  中断不能な古いdecodeが終わるまでは次のdecodeを並行起動しない。
- 同時voiceは1個（source 1、gain 1）。連続BITEは旧voiceを停止・disconnectして置き換える。
- 正常終了、途中の割り当て／接続／start／stop失敗でもsource／gainを解放し、source.bufferをnullにする。
- blur、hidden、pagehide、context中断・閉鎖で再生中voiceを即時解放する。
  focus／pageshowだけで古い通知を再開しない。blur中の新規BITE抑止は既存mainの時計停止に従う。
- context閉鎖時はPCM・取得データを解除し、取得をabortする。
  sessionが購読者を消してからcloseする場合も、context自身のstatechangeを観測して解放する。
- WebGL喪失はcapture listenerからdisposeし、メインの既存エラー案内を妨げない。
  明示的disposeも購読・DOM listener・context listenerを解除する。

単体テストで1000回の連続発火を行い、decode 1回・PCM 1個・同時ライブノード最大2、
正常終了後のライブ接続0・全source.buffer=nullを観測する。
これはキャッシュとノードの検証であり、実機の長時間ヒープ計測とは区別する。

## 音量上限と検証

同一rateのPCMを用いた参照計算では、環境音目標mix＋通知の三角不等式上限は0.23501749。
各channelが異なる80msランプ位置にある保守的な上限は0.28980140。
鳥・鈴虫のうち最大peakの1 voiceを音量100%で加えても0.31055897。
通知decodeのリサンプル余裕（peak最大1.25を許容）を含めても0.36368397で、0.37未満。
環境音だけの従来のpeak／RMS検証は維持する。

tests/browser/audio-gain.spec.jsは実際のプレイヤーとWAVをChromiumのOfflineAudioContextへ通し、
44.1／48kHzそれぞれで単独・昼・夜・濃霧＋生物音の8条件を数値JSONに保存する。
再生予約、波形開始、peak／RMS、有限値、クリップ、終了後の参照解除を検証する。
音量しきい値やOfflineAudioContextは、OS・スピーカーの遅延や人間の聞こえを再現しない。

Chromium 154.0.8037.57での実測（RMSの集計窓は通知開始から0.98秒、環境音量100%）:

| 条件 | 44.1kHz peak | 44.1kHz RMS | 48kHz peak | 48kHz RMS |
| --- | --- | --- | --- | --- |
| 通知単独 | 0.201289415 | 0.006769490 | 0.196875006 | 0.006769881 |
| 昼＋鳥 | 0.201477870 | 0.011392328 | 0.197066605 | 0.011391417 |
| 通常夜＋鈴虫 | 0.201305345 | 0.010052322 | 0.196885183 | 0.010051553 |
| 濃霧＋鈴虫 | 0.201321930 | 0.009733347 | 0.196884185 | 0.009722761 |

生物音は現行PCMとsampleBioGainで最大ゲインを固定した保守的な重ね合わせで、鈴虫の自然フェードは省く。
表は固定の開始位相での実測であり、任意位相の上限は前述の三角不等式と区別する。
全8条件で非有限値・クリップは0、取得／decodeは事前の各1回だけ、通知終了後のライブノードは0でsource.bufferもnull。
通知単独の−40dBFS超えは44.1kHzで17.369615ms、48kHzで17.375ms。終了後は厳密に0。
44.1kHzではPCMが1フレーム短く、実再生長は約0.979977秒。48kHzでは0.98秒。
予約はcurrentTimeで行い、意図的な待ちを加えない。出力機器までの総遅延は未測定。

単体は未unlock・拒否・非対応、未準備、取得／decode失敗、復帰・閉鎖とcontext置換、
古いjob完了、連続BITE、例外時解放、環境音OFF／音量0での独立経路を検証する。
局所E2Eはfishing、audio、audio-gain、影響するbio-audio、PC／touch smokeを対象とし、
ローカル全件E2Eは実行しない。CI分類はL2で、PRのregular／mobile全件とci-requiredはPMが確認する。

## 実機の受入

ユーザーによるマージ・デプロイ後に、次を別ゲートとして確認する。

- 「水滴」として自然に聞こえ、単発の通知として気づけるか。
- 昼夜のBGM、鳥・鈴虫を重ねても識別できるか。
- スマートフォン・低音量で過大なピークや聞き逃しがないか。
- BGM OFF／音量0でも通知が有効か。
- 音の終了を待たずアワセでき、失敗時も通常どおり再挑戦できるか。
- ロック・タブ移動・着信等の中断後に、古い通知がまとめて鳴らないか。

実機聴感、端末出力までの総遅延、iOS Safari／LINE等の実機挙動は未確認。
