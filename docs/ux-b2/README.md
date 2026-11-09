# UX-B2 ヘルプ・受動QTE図形共有

基準main: `fcdc51b2a8eb30c9556b77bf0a6275829b62c495`。Phase UX+P-5 / UX-B2。
実装前G0: origin fetch/pushは `https://github.com/tk0mygit/barb.git`、remote/mainとGitHub mainが基準SHAに一致、既存`work` checkoutはclean、open PRなし。最新mainから `codex/ux-b2-help-and-qte-glyphs` を作成。

## 実装前の変更影響行列

| 領域 | 直接変更 | 間接的な観測差・維持条件 | 局所検証 / PRゲート |
| --- | --- | --- | --- |
| ゲーム状態・確率・時計 | なし | メニュー訪問が長くなる。既存open/closeによるpauseを維持、helpは状態を読まない | collection-menu、QTE production/public、両smoke |
| 入力 | 既存子画面遷移へのhelp接続のみ | native scroll/Tab/touchとcanvas入力解除・復帰、BITE/FIGHT/QTE所有を維持 | help/menu-navigation、QTE operations/production |
| カメラ・WebGL描画 | なし | メニューで覆われる時間のみ。ゲームの撮影状態・追従条件は不変 | 両smoke、mobile-layout、既存QTE production |
| HUD/DOM・geometry | 末尾helpカード、同一dialog内4節、共有受動図形と局所CSS | 唯一のscroller/observer root、固定44px controls、1列help、親focus復元。本番QTEのDOM・円中心/径・hit region・presentation境界は同値 | help、menu-navigation、QTE UI productionと既存HUD Unit |
| 保存・売価・取引 | なし | 共通保存全文/live/ARIA・実所持金を保持。helpは保存APIを呼ばない。quote消費・売却・購入条件不変 | save-status/save、fish-sales、equipment、achievements |
| 画像・音声 | なし | helpは画像を登録しない。既存renderのobserver dispose/refreshとsound購読破棄を維持 | fish-assets、fish-image-loading、audio。ERR_ABORTEDは既存auditで調査 |
| E2E撮影・比較器 | help spec追加、5→6の仕様assertion更新 | 新規UI証跡を実ゲーム/fixtureで区別。既存QTE・Mobile画像比較の閾値・対象は維持 | 関連spec局所実行、PR L2全件 |
| CI集約器 | なし | 新規specは既存inventoryから収集。Regular A/B/C+Mobileの元ID和集合一致・重複0、34組/68画像・二親/SHA/ref/run/attempt検証を維持 | 実ci-requiredはPM確認、Codexは未確認 |
| workflow/CLI・依存 | なし | scripts/ci-risk.js、権限、timeout/retry、依存追加なし | npm ci / Unit / build / diff check、PR L2 |
| UIモックとの差 | モックを製品へ転用しない | 参照ZIP2点・原案MDは開始時未提供。指示本文とmainを正本に実装し、固定金額/保存状態・UX-A表記を入れない | モック画像比較は資料提供まで未実施 |

## 最小設計

- 既存menuEntries末尾に補助色helpを追加。既存render/openChild/returnToを利用し、追加route/history/保存状態を作らない。
- 表示専用helpモジュールはプレイ→QTE→メニュー→セーブの4節を常時DOMに置く。任意の節内移動は同じpane内で見出しへscroll/focusする。
- QTEの静的SVG・円の形・3タップ進捗・実表示ラベルのみ副作用のないモジュールへ抽出。本番HUDのgeometry/update/presentationと既存CSSサイズ/位置を維持し、helpの配置はhelp専用CSSで定義する。
- 新規spec/共有表示モジュール・複数UI領域のためL2。PR提出後のCI待機・監視・polling・rerun、マージ・デプロイ・実機受入は行わない。

## 検証記録

実装sourceは `ff2ace63f628081f57e9f3265575267a5245bc5d`。以後のテスト・証跡・説明文書commitは製品sourceを変更しない。`src` treeは `2ff6ac86a5649300509daa0f94590a135297b544`。

### 参照とモック比較

作業途中で提供された `BARB_UX_A_デザインモック追補_2026-11-09.zip` の決裁資料、ソース、PC/phone/短横PNG、計測JSONを照合した。ZIPのSHA-256は `ee42dfac972bc07c0bf55d078e027f8d91adfaf02392651f4cd26ecbf45919ab`、収録manifestの全項目が一致。

主要4/補助2の配色、6入口順、番号付き4節、PCでの表示名/説明の行、phoneでの折返し、4操作の縦1列、図の濃度とflick/swipeのサイズ差を反映した。モックソースは参照だけに用い、製品のrender責務に合わせて局所実装した。共通ヘッダー・保存全文・実所持金・一時停止の説明はUX-B1の本番構造を保持したため、モックの省スペース上部とは高さが異なる。静止した見本背景・固定保存状態・固定所持金・UX-A表記を持ち込んでいない。

元UX-A ZIPと原案MDは未提供。今回の指示本文、承認済み最終追補、最新mainを照合した。

### 本番QTEとの等価性

[source監査JSON](qte-source-audit.json)はbaseと実装sourceを独立に読んだ比較。両版のHUD生成をVMで実行し、初期HTMLが652 bytes・SHA-256 `2e4fc0d3dbeca8a48ade6afaa05c86877e1c54f6fdeeee8c76beba5d0304fdd1`で完全一致した。arrow/target markup、実表示ラベル、tap formatterの4置換を逆適用した残りHUDコードはbaseとbyte一致。円装飾ruleを再結合した既存QTE CSSもbyte一致した。geometry・delivery・時計・判定・provider・fight・mainは変更なし。

helpの唯一のimportは受動glyphsで、glyphsは依存なし。円装飾は共有CSS、SVG/1本・2本構成/3タップ進捗/実ラベルは共有JSが単一の定義元。helpのclick listenerは文書内ジャンプだけで、見本にはlistener/入力/残時間進行を持たせない。sourceの等価性は実computed geometryや入力の合格と区別し、既存Browser assertionsで別に検証する。

### PR L2の収集確認

[収集監査JSON](collection-audit.json)はBrowserを起動しない `--list` だけの局所確認。テスト更新後の `a1f9804643dc34fe29fd1ff5cfab1efe727cd642` で45 spec・430 IDを元の全選択から収集し、Regular A 13spec/128 ID、B 15/125、C 16/119、Mobile 1/58の和集合が完全一致・重複0。helpはBの9件。既存profileの未登録警告はhelpとmenu-navigationで、既存分配規則により配置される。profileや分類器を変更していない。

Mobile58テストは34組/68画像とは異なる単位。実画像比較、実L2、validation merge二親、SHA/ref/run/attempt、ci-requiredの判定は本収集の成功に含めない。PRでの全4系統と厳格な最終集約をPMが確認する。

### 本番ビルドの画面証跡

以下の8枚と [画面計測JSON](ui-observations.json) は実際の製品build。モック画像や物理端末での受入とは区別する。system Chromium、DPR1、reduced motion、touchはエミュレーション。静止画の操作は一時的なtap highlightを避けるtrusted mouse clickで行い、native touch/panは別のBrowser assertionsで確認した。

| 条件・内容 | 画面 |
| --- | --- |
| PC 1280×800、6入口・2列×3行 | [メニュートップ](pc-menu.png) |
| phone 390×844、1列ヘルプ先頭 | [ヘルプ](phone-help.png) |
| PC、静止したQTE全4操作と実ラベル | [4操作](pc-qte-first.png)、[後半とメニュー節](pc-qte-last.png) |
| 568×320 / root20px / safe上下8・左右12px、霧夜 | [先頭](short-help-top.png)、[最下段helpカード](short-menu-help.png)、[円ターゲット行](short-qte-target.png) |
| 同短横、実Storage書込みの容量不足 | [警告全文](short-warning-help.png) |

画面計測ではPCのpane可視高646px/help全高2127px、phoneは662px/3093px、短横は214px/3037px。値は撮影時の実保存表示を含み、固定のUI期待値ではない。全6カードと4節へ到達し、通常4条件（PC/phone/短横霧夜/晴夜）のQTE4行全てがpane内に入り、横overflow 0、親のhelp focus/scroll復元、×/Esc後canvas focus、再open先頭0を確認した。

霧夜・晴夜は既存の検証済み保存fixtureから通常復元し、既存Three devtools observer経由で実rendererの最初の空・霧を保存時計由来の値と比較した。実プレイヤーのデータ、実保存成功、物理端末の結果ではない。phone画像の「未保存の変更」は撮影時の実dirty状態であり、正常表示へ置換していない。容量不足画像もテストContextでsave slotのStorage書込みにQuotaExceededErrorを返した通常flushの実警告で、save-statusへ成功/失敗を直接注入していない。撮影時のpageerror/failed requestはcontext破棄前に全0件。

### 局所Browser結果

最終的な成功は135ケース（重複なし）。新規help9件は通常PC、PC文字200%/root32px、390×844、320×568、短横root20px/safe、844×390、keyboard/native pan、警告全文、受動性を含む。root32pxではメニューも6枚全て1列をassertした。

| spec | 最終成功数 | 範囲 |
| --- | ---: | --- |
| help | 9 | 全件（基本8＋追加PC文字200%1） |
| menu-navigation | 9 | 全件、全保存phase/長文警告を含む |
| collection-menu | 3 | 全件、pause/input/未発見秘匿 |
| mobile-layout | 1 | 全件、短横/文字拡大/回転 |
| smoke-pc / smoke-touch | 2 | 両スモーク全件 |
| qte-operations | 19 | 全件、円中心/64・80px/500ms/短横/回転/resume |
| qte-production | 22 | 全件、ON/OFF/復帰/売価/保存/遅延フレーム |
| qte-public-on | 10 | 全件、公開buildの4操作と全失敗 |
| qte-ui-production | 1 | 全件、native 0.5秒/実表示境界/source replay |
| fish-assets | 15 | 全件、36画像×PC/縦/横と厳格なRequest ID/dispose監査 |
| fish-image-loading | 12 | 全件、paint/decode/observer/キャンセル |
| fish-sales | 2 | 全件、個別/一括/即時売却 |
| equipment-ui | 4 | 全件、条件/quote/単回消費 |
| achievements | 6 | 全件（初回4成功＋期待値修正後2成功） |
| save-data | 3 | 全件、復元/履歴/通知 |
| audio | 9 | 選択ケース：3サイズの設定/復帰、全preferences故障、native出力graph |
| autosave | 8 | 選択ケース：バックアップ/破損/未対応/容量/不可/競合/2サイズ警告 |

audio/autosaveの非選択ケースは未実行。ローカル全件E2EやMobile比較を実施したという意味ではない。全結果と初回履歴は [検証サマリー](validation-summary.json) を参照。

### 失敗履歴と是正

- 新規glyph受動性テストの初回は子プロセス起動がsandboxのEPERMとなった。exact module sourceを隔離VMで評価する方式へ変更し、DOM/時計/RNG/timers/input/WebGLの拒否assertionを保持して4/4成功。既存HUD9件も成功した。
- 初回全Unitは1185 reports中1184成功・1ファイル失敗。既存lake-scenery比較が固定参照する履歴commitがcheckoutに無かったため、同じoriginから当該SHAを取得した。失敗したファイル4/4を確認し、最終全Unitを再実行した。テストや比較条件を緩めていない。
- 参照追補が到着した時点の初回Browserを11成功/64未実行で手動終了（exit130）し、承認モックへの表示調整後、対象75件を再収集・実行して75/75成功した。製品assertionの失敗による無根拠rerunではない。
- 関連42件の初回は40成功/実績2失敗。ambientAudioなしの既存UI fixtureが旧4入口を期待していたが、承認済みhelp追加後は5入口だった。完全一致配列の末尾へhelpを加えた1行だけを修正し、失敗2件の全実績assertionを再検証して2/2成功。他の期待値・timeout/retryは維持した。全testsのメニュー期待値を再検索し、他の古い入口数は残っていない。
- 初回npm ciのsandbox内proxy/既定npmログ領域と収集用git spawnのEPERMは、既存環境の許可済み実行と`/tmp` cacheで解消した。依存追加・アプリ権限・ネットワークpolicy変更はない。raw logs/traceは実行環境の`/tmp/barb-ux-b2-*`に保持し、PRへtraceを混入させていない。

`npm ci`成功、最終`npm test`は実収集1188件全成功（fail/cancel/skip/todo 0）、`npm run build`成功、`git diff --check`成功。製品sourceは実装commitと同じtreeのままで、テスト・証跡・文書だけを後続commitに含める。

### 残存リスク・未実施

PRの実L2（Regular A/B/C＋Mobile全件）、34組/68画像、validation merge二親とSHA/ref/run/attempt、ci-required、マージ、Pages、物理端末受入は未実施/未確認。PM/ユーザーPMの工程で確認する。Codexはpush/PR提出後にCIを待機・監視・polling・rerunしない。

今回の実画像表示に意図しないERR_ABORTEDは検出されなかった。既存監査の稼働中abort拒否・dispose対応等の条件を維持している。PR #76で発生したbowfinの未確定根因を、本PRで解決したとは扱わない。
