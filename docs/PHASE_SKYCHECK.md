# Phase SkyCheck A/B 実装・依存監査

新規Codexチャットで実装、同じPRの修正はこのチャットを継続する。
推奨モデル・思考レベル: Codex / 高。ユーザーPM承認済みのA/Bを一つのL2 PRとする。
基準main・着手checkout: `bbdf5a4d1827b6917b68cfe41cf5503e8e9876c1`。
2026-11-13に`git fetch origin main`後の`origin/main`と一致、作業ツリーはclean。
既存checkoutを使用し、worktreeは追加しない。マージ・デプロイはユーザーPMのみ。

## 実装前の変更影響行列

| 領域 | 直接変更 | 間接的な観測差・維持する契約 |
| --- | --- | --- |
| ゲーム状態・確率・時計 | 時計専用スキップ所有者を追加、mainの時計呼出しを接続 | 通常1倍、固定した次境界まで18倍・最大10秒。共有乱数を消費しない。船・釣り・QTE・報酬更新を凍結 |
| 入力・タッチ・ライフサイクル | mainでcontrols無効化・解除、全操作入口を遮断 | setEnabledは保持入力・captureを破棄する。blur/hidden/pagehide/context lossで中断、再開時の非操作時間を補填しない |
| カメラ・描画・環境 | renderer/湖/星/流星/オーロラの実装変更なし | 通常renderer経路とclockサンプルを継続。カメラと船を固定。時計に依存する環境と自然音だけ逐次変化 |
| HUD・DOM | 単一dialog内に設定/プレイ階層、アイコンボタン追加 | トップのsoundをsettingsへ。sound/playの戻り先はsettings。focus/scroll/Escapeを維持。初期OFFで既存HUD寸法を維持 |
| 音声 | 音声実装・保存変更なし | サウンド画面の配置だけ変更。unlock/retry/購読解除を維持。audio fixtureと直接sound遷移テストを全検索して追従 |
| 保存・売却・実績 | 独立したversion付きプレイ設定保存を追加 | ゲームsettings:{}と既存音キーは変更しない。markProgressとautosave周期を維持。時計だけ既存セーブへ保存 |
| E2E撮影・fixture | 関係メニュー期待値/音声遷移を更新、新規局所spec | createCollectionMenu呼出しはmain、UI/QTE fixture、画像計測CLI。新規設定依存は省略可能。既存比較はOFFの同一入力 |
| 比較器 | 変更予定なし | 34組/68画像、source provenance、strict GPU/camera/HUD検証維持。ONでの意図した時計差は独立したclock/環境サンプルから照合 |
| ci-required・CLI | 変更予定なし | main/input/新規specによりL2。全inventoryからRegular A/B/C/Mobileへ配賦。単体で撮影/比較/最終ゲート/CLIの契約を検証 |

## 参照・更新の境界

- 本番`gameClock.step`はmain loopの1か所。その他はUnit、音声preview、独立source replay。
- `createCollectionMenu`はmain、`ui-fixture.js`、`qte-fixture.js`、`measure-fish-images.mjs`。
- `HUD.update/ready`、`ambientAudio.update`、`autosave.markProgress`を監査。
  スキップの終了フレームも物理入力更新は凍結し、次フレームから通常速度へ戻す。
- `controls`のpointer/keyboard/reset、fishingInput/QTEの時間管理、準備・釣果dialog、
  メニュー開閉、focus/visibility/page lifecycle、WebGL失敗経路を確認。
- 夜の霧・星・流星・オーロラは保存時計から決定論的に算出される。
  スキップ状態は保存しない。設定ストアは欠損/破損/例外/別タブでOFFへ閉じる。

## 検証計画・ゲート

| レイヤー | 局所検証と成功条件 |
| --- | --- |
| Unit | 全`npm test`。18倍境界/FPS/高位時計/通常1倍/中断/設定検証と保存例外/乱数・保存保護、および既存比較器・集約CLIの正常/拒否fixture |
| Build | `npm ci`、`npm run build`、`git diff --check` |
| 関係E2E | PC/touchスモーク、設定階層・音声往復、スキップと操作遮断、ライフサイクル、保存、環境/資源、PC/タッチ縦横レイアウトを局所実行 |
| Regular A/B/C・Mobile | L2の全選択・全実行はGitHubへ任せる。ローカル全件実行をしない |
| ci-required | 実CI成功はPM確認。合成Unitや局所画像を全34組/68画像のCI成功と扱わない |

実施件数・初回失敗・修正根拠・未実施・リスクはPRに記載する。
push・PR URLの報告で終了し、CI待機・監視・rerunを行わない。

## 初回検証の診断と対応

- サンドボックス内の`npm ci`はproxy/cache、UnitはGit子プロセスの`EPERM`、
  Playwrightは127.0.0.1のlisten `EPERM`で停止。許可された実行環境で同じ検証を行う。
- 最初の実ブラウザ実行でQTEの未定義中断理由を検出。READYの操船だけから開始するため
  その呼出しを除去した。QTEの理由・既存の時間処理・assertionは変更しない。
- 新しいHUD要素のquerySelector/toggleAttributeをUnit DOM fixtureへ追加した。
  capture listenerの解除も同じcapture option objectで指定し、解除試験を通した。
- 過去描画比較が必要とする`eb10aa13ec302a7a4c9b4a421a596f447c8f6e7c`を追加fetch。
  未コミットsourceを拒否する既存Unitはコミット後のcleanなsourceで最終実行する。
- 既存CAST比較の厳密な文字列・assertionを保つためblurの描画リセットと中断処理の配置を整理。
  旧V1と現V3の比較は既存serializerによる正規の移行後に行い、実績contractを含めて比較する。

初回ログは`/tmp/barb-skycheck-*.log`、ブラウザ診断は
`test-results/local-skycheck-initial/`、`local-skycheck-qte-fix/`に保持する（コミット対象外）。

## PR #84 Regular Aの局所是正（2026-11-13）

同じPR・チャット・ブランチを継続。開始時HEADは
`3cf92ce404308b7cbc36edaa35c1a8a56fa807d9`、再fetchしたmainは上記基準と一致しclean。
失敗検証merge `ea444072e12c8e4d82f93921d16dafe085a9fc0e`の親は
main `bbdf5a4d1827b6917b68cfe41cf5503e8e9876c1`と対象HEADに一致した。

Run `43395332940`のattempt 1/job `131785628557`、attempt 2/job `131801333052`の
ログはともに`final-stability.spec.js:248`（リロード・チェックポイント・メニュー閉鎖後）の
native tapで`ready / inactive`不一致を記録していた。最初の釣り開始ではない。
artifact `14026493715`は接続ツールから配信参照を取得したが、ローカル取得は配信先403。
CIのバイナリは未確認とし、ローカルのJSON/PNG/traceで補完した。

変更前の元specをそのまま390×844 / DPR0.5 / hasTouch / isMobileで実行し、同じ248行目の
15秒タイムアウトを再現。3周の捕獲・経済・保存・資源検査まで進んだことも保存した。
次に両SHAを一時archiveへ展開し、元specの全操作・期待を保持した観測だけを追加した。
製品checkoutにはdebug APIを追加せず、一時観測コードは`/tmp`へ退避した。

| 実観測 | 変更前PR HEAD | 基準main |
| --- | --- | --- |
| ボタン・native配送 | visible/enabled、hit=fish-button、inert=false、dialogなし。pointer/touch/clickがcapture/target/bubbleへ到達、defaultPrevented=false | 同じnative経路で成功 |
| 入力ガード・モード | OFF、skipActive/skipLocked=false、guard reject=false。changeMode呼出し、enterFishing=true、boat.mode=fishing、内部phase=ready | enterFishing=true |
| focus/WebGL | focused/renderHealthy=true、hidden=false | focused=true、hidden=false |
| tap後12フレーム | pageActive=false、HUD更新0回、時計停止、DOM inactive/hiddenのまま | HUD更新12回、時計1倍、DOM ready/表示 |
| 元spec全経路 | FAILを再現 | PASS |

原因は新しい`pageActive`ラッチ。既存の可視チェックポイント通知`pagehide`でfalseになり、
`pageshow`なしで続行するOFFの通常プレイまでmain loopが早期returnしていた。
入力拒否・停船判定・focus喪失・HUDの表示計算が原因ではない。
是正はこの追加停止条件を設定ON時に限定し、OFF時は元のhidden/focus/menuの契約へ戻す。
ONのpagehide中断・非アクティブ時間の非補填は維持し、元のfinal-stabilityと共通fixtureは変更しない。

| 依存領域 | 直接変更 | 間接影響・保護 |
| --- | --- | --- |
| main loop・時計・物理 | pagehideラッチの適用条件だけ | OFFの通常1倍更新を復旧。18倍・境界・船/釣り/QTEアルゴリズムは変更なし |
| 入力・カメラ・HUD | 変更なし | 受理済みnative tap後の通常更新が再開。保持キー破棄・操作遮断は既存のまま |
| 保存・経済・音・環境・GPU | 変更なし | schema/頻度/RNG/抽選/素材/資源契約を維持 |
| E2E | SkyCheckへOFFのnative checkpoint回帰ケースを追加 | 旧spec、12 tick、ready要求、3周/保存/履歴/資源検査を維持 |
| 比較器・ci-required・CLI・CI | 変更なし、L2継続 | 全Regular A/B/C、Mobile 58、34組/68画像を要求。局所PASSとCI成功を区別 |

根拠は`test-results/pr84-before-native/`、`pr84-observed-head/`、`pr84-observed-main/`と
`/tmp/barb-pr84-main-head-comparison.json`に保持。実行環境はChromium 154/SwiftShader、
CIログのChromium 156とは異なるが、同じnative症状と停止状態を再現した。
最終の実施/未実施・最新HEADはPR本文へ追記し、CI監視・rerunは行わない。
