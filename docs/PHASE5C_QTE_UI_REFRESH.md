# Phase 5C QTE UI refresh

## 開始・承認範囲（実装前記録、2026-11-03 UTC）

- 本チャットで新規の5C-QTE-UIを実装し、独立PRを1件提出する。モデル／思考設定は本セッションの設定を継続する。
- 承認main／開始HEAD／実remote `refs/heads/main`: `0cc246e387585363747a24ea82d818f91ba95bfe`。
- 既存checkout `/workspace/barb`、開始branch `work`、未コミット差分なし、worktreeは1つ。
- 開始時の追跡`origin/main`は`0a336ef674d6d5f637f7c35ffcd467fadbe3625a`。実remote一致確認後、`git fetch --no-tags origin`で承認SHAへ更新した。
- 専用branch: `codex/5c-qte-ui-refresh`（承認SHAから作成）。破壊的操作・worktree追加なし。
- 正本: `AGENTS.md`、`CODEX_OPERATING_RULES.md`、`TESTING_WORKFLOW.md`と今回のユーザー承認。旧HUD非重複・compact配置は今回のみ置換する。
- 予想変更: `src/ui/qte-layout.js`、`src/ui/qte-hud.js`、`src/ui/style.css`のQTE定義、対応Unit／browser spec・QTE専用fixture、本書、`docs/QTE_OPERATIONS.md`。
- 入力・採点・時計・provider・ゲーム状態・保存・経済・描画・他Phaseは変更しない。PR後はCI待機・監視・マージ・デプロイ・実機受入を行わない。

## 変更影響行列（実装前）

| レイヤー | 直接変更 | 間接的な観測差／不変条件とゲート |
| --- | --- | --- |
| UIレイアウト | canvas／safe／visualViewport交差の中央へ拡大 | HUDと重なる。有限矩形、safe内、短い横画面、fractional px、不可時明示失敗をUnitとDOM実測で確認 |
| HUD DOM | SVGの1本／2本、終点撤去、静かなtarget | descriptor・既存dataset・pointer-eventsなし・実DOM region／target中心を維持。表示のprepare／present順序を維持 |
| CSS | QTE専用の透明容器・前景・細ゲージ | 共通CSSと他HUDは変更なし。PC／タッチ縦横、状態文言、透明性、視認性、hit-testを確認 |
| 入力アダプター／採点 | 変更なし | region拡大で新しく入る始点のみ受理可能。距離・角度・期限・primary pointer・revision・identity・anti-replay等の既存負例を全Unitで保持 |
| ゲーム状態／確率／時計 | 変更なし | 0.5／1／1.5秒、3tap 2秒、予告、suspend／resume、表示前拒否、次フレーム表示、seal／単一commitを確認 |
| FIGHT／カメラ／3D描画 | 変更なし | 背景との重なりは承認済み。実FIGHT HUD上でcanvasへのnative入力と採点を確認 |
| 保存／売価／通貨／実績 | 変更なし | 既存全Unit維持。関連する全件E2EはCIへ委任 |
| E2E撮影 | QTE専用局所証跡と旧視覚assertion更新 | 入力・表示・時刻・DOM矩形・source provenanceを保存。全件ローカルE2Eは実行しない |
| Mobile比較器 | 変更なし | 34組／68画像、原本SHA、capture／compare契約の緩和なし |
| CI集約／CLI／workflow | 変更なし | L2。Regular A／B＋Mobileの収集・実行ID完全和集合、同一build、validation merge二親・base／HEAD、`ci-required`の監査をPMへ委任 |

## 比較設計・実装前の初期案

- 8 CSS pxの内側余白を残し、有効幅の90%（上限720px）、有効高さの90%（上限440px）を中央panelにする。regionはpanel幅と同じで上下44pxを表示に予約し、region自体の中心を有効領域中心に一致させる。最小panelは216×208px（region高さ120px）。数値はPC／縦横のDOM・hit-test後に確定する。
- 非操作HUDをobstacleやsignatureに含めない。canvas／safe／visualViewport実座標だけを測定する。resize／orientationの既存契約とdelivery制御は維持する。
- 同一SVG基本形を4方向へ回転。flickは1個、swipeは2個を縦／横に等間隔表示。`.qte-arrow`と`data-direction`を維持する。
- targetは原則細い単円（fine pointer直径64px／coarse pointer直径80px）。案内に両入力の半径を明示し、hybridでも表示円が全入力共通の採点境界という誤解を防ぐ。中心は実DOMから読む。
- 旧非重複・compact横並び・終点・文字矢印・二重円・outline前提を横断検索済み。旧テストは新承認仕様へ明示置換し、safe・寸法・中心・採点・時刻のassertionを保持する。

## 検証計画（実装前）

- `npm ci`、全`npm test`、`npm run build`、`git diff --check`。
- layout／HUD Unit: 中央・拡大・safe／viewport・短横・fractional・不成立、実DOM region／target、HUD変動とrevision、全方向SVG・操作分離・透明CSS。
- 採点: 既存負例一式＋拡大regionにのみ入る始点の受理と閾値維持。
- 局所E2E: 既存qte-operations代表ケース、PC／touch縦横、flick／swipe各4方向、tap／target、0.5秒、menu再開、実FIGHT HUD hit-test、短い本番描画フレーム境界ケース。画像／JSONは生成物としてコミットしない。
- 全件CIは未実行としてL2で提出し、PR後の監査は9th_PM、実機受入・最終承認はユーザーPMへ引き継ぐ。

## 実装数値と比較

幅90%の初期案は360px幅／左右safe24pxで旧region幅272pxを下回るため、実装前比較で94%へ修正した。確定式は交差領域を各辺8px内側へ取り、panel幅`min(720, 内幅×0.94)`、高さ`min(440, 内高×0.90)`、regionはpanel上下44pxを除いた中央矩形。最小panel216×208px未満は明示失敗とする。すべてCSS pxで、整数丸めは行わない。

| viewport | safe（左右24／上下16）でのpanel | region | 中心 |
| --- | --- | --- | --- |
| 1000×700 | 720×440 | 720×352 | 500,350 |
| 390×844 | 306.44×440 | 306.44×352 | 195,422 |
| 844×390 | 720×307.8 | 720×219.8 | 422,195 |
| 568×320 | 473.76×244.8 | 473.76×156.8 | 284,160 |
| 360×640 | 278.24×440 | 278.24×352 | 180,320 |

旧非障害物配置のregionは最大280×140px（360px条件では272×140px）、短横の実HUD回避では84×80pxまで縮小していた。各代表条件で縦横とも拡大し、8pxの余白とsafeを保つ。`compact`属性は高さ300px未満の文字密度用に残し、中央軸や受付位置を横へ変更しない。

## 導入・診断記録

- 最初の`npm ci`は既定cache `/home/agent/.npm/_cacache`の書き込み不可によりENOENTとなった。依存関係／lockfileを変えず、`npm ci --cache /tmp/barb-npm-cache`は成功（21 packages）。環境固有のcache先変更であり依存の緩和はない。
- Chromiumは環境既存の`/usr/bin/chromium`を`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`で指定する。
- 初回`npm test`は69ファイル中9ファイルで失敗。詳細診断では制限sandbox内の`spawnSync git EPERM`と既存比較Unitが参照する履歴commit `eb10aa13ec302a7a4c9b4a421a596f447c8f6e7c`不足を確認した。通常の`git fetch --no-tags origin <そのSHA>`で履歴objectだけ取得し、子プロセスが動作するnetwork許可環境で再実行した。全1,032件PASS、skip／retry／assertion緩和なし（ログ`/tmp/barb-npm-test-network.log`）。
- 初回Buildは成功。既存Three.js chunkの500kB警告は残る。依存・build設定は無変更。

## 最終実装・ローカル結果

検証ソースHEADは`a5d32a5fb76e617c7bca65af66615ee3bcd1c43f`、`src` treeは`f086bd876d3a1737fa1300cd420f1478534311ab`。以降の引き継ぎ文書コミットはこのruntime treeを変えない。承認baseは冒頭の`0cc246e387585363747a24ea82d818f91ba95bfe`。提出直前の実remote mainも同SHAだった。

- 最終`npm test`: **1,034件PASS**、fail／skip／retryなし。最終ログ`/tmp/barb-npm-test-final2.log`。
- 最終`npm run build`: PASS、94 modules。`/tmp/barb-build-final2.log`。Three.js chunk警告のみ。
- QTE局所E2E: **20件PASS**、skip／flaky／retryなし、105.46秒。`/tmp/barb-qte-ui-final.json`と`.log`。
- PC／タッチ共通スモーク: **2件PASS**、約1.3分。`/tmp/barb-qte-smoke.log`。QTE修正前後で起動／操船／タップの実装は無変更。
- `git diff --check`: PASS。ゲーム／入力／時計／provider／main／保存／経済／描画／Mobile比較／CI／依存への差分なし。追加アセットなし。画像・trace・dist・node_modulesはコミットしない。
- 全件E2Eは**未実行**。CI比較モード相当の`--list`のみで**36 spec／345件**（Regular287＋Mobile58）、ID重複0。`/tmp/barb-qte-all-collection.json`と`/tmp/barb-qte-collection-ids.json`。これはCI成功ではなく、この時点の収集結果である。

前景はSVG灰白`#e1e5e1`・opacity **0.68**、flick正方形64〜100px、swipe各44〜68px、gap10〜18px。上下／左右各2個の実SVGで、引き伸ばしなし。文字13／12px、ゲージ3px・最大幅360px、残り`min(300ms, duration×0.3)`以下で鈍い赤`#b9827b`。時間計算は既存式のまま。大画面の状態文は中心から上128px、案内は上106px、タイマーは下約128px以内へ寄せ、短画面ではpanel内へ収める。panel／gestureの背景・border・outline・box-shadowは全状態でなし。

geometry署名は有効交差矩形だけにする。外側canvas端や無関係なHUD移動でrevisionは変わらず、実DOMのregion／target中心がCSS transform等で変われば1回だけ失効する。explicit resize／orientation、blur／hidden／menu、prepare／present・次フレーム成立の既存delivery契約は維持した。配置不可の文言も有限の交差領域内へ収め、採点geometryを捏造しない。

### 初回E2E失敗と局所修正

初回20件は1件PASS／19件FAIL（`/tmp/barb-qte-ui-first.json`、`test-results/local-qte-ui/`にtrace／診断を保持）。18件はこのChromiumの`outline:none`が計算値に幅3pxを残す点で失敗し、CSSを`outline:0 none transparent`に明示してassertionを維持した。残る本番ケースは実操作・採点・単一commitまで成功後、要求Y191.6とnative Y191.60000610351562の完全一致で失敗した。新テストの候補始点を**入力前に整数CSS pxで選択**し、region内／FIGHT内／旧region外・hit-test・native座標完全一致の全条件を維持した。タイムアウト増量、skip、retry、採点変更なし。実装変更と根拠に基づく再検証であり、同一HEADの無根拠再試行ではない。

### 旧テストの置換根拠

- layout Unitの「HUD非重複」「全域障害物で不成立」は、承認された中央・重なり許可へ置換。safe、最低寸法、targetの40px余裕、不成立時nullを保持し、中央・旧region縦横拡大・fractional・非有限値を追加。
- compact横並びの位置条件は廃止。短横でも中央で入力距離を確保する。
- browserのtarget二重円80／64pxは単円fine64／coarse80pxへ置換し、実DOM中心と両入力半径の案内を検査する。採点境界の既存Unitは全件保持。
- browserのHUD非重複assertionは中央・safe・拡大・25地点hit-testへ置換。旧layout関数は承認SHAから独立に読み込み、新しい始点が旧region外であることを実証する。
- `.qte-arrow`／`data-direction`等の参照先を保持。`.qte-endpoint`は生成・CSSから撤去し、DOMに存在しないことを検査する。

### 実行ID（QTE20件すべてPASS、retry0）

`tests/browser/qte-operations.spec.js`:

| 操作／ケース | Playwright ID |
| --- | --- |
| mouse flick | `2310e6ca7b6bef0d3153-32aa2d76357eb9106193` |
| mouse swipe | `2310e6ca7b6bef0d3153-5fc2ca05d81e4a3dfdd0` |
| mouse tap | `2310e6ca7b6bef0d3153-fd381eb07607f56622cd` |
| mouse target | `2310e6ca7b6bef0d3153-1bcac4e4d14195023d3c` |
| touch flick | `2310e6ca7b6bef0d3153-a50d3c0ec83579f82fc7` |
| touch swipe | `2310e6ca7b6bef0d3153-167a0581115237b482f3` |
| touch tap | `2310e6ca7b6bef0d3153-7d91c6e760433127a922` |
| touch target | `2310e6ca7b6bef0d3153-ed7ceb5b66d411aa44dc` |
| safe／resize／短横／pinch1.125／不成立 | `2310e6ca7b6bef0d3153-49c05714b662aa07894a` |
| menu／tap checkpoint復帰 | `2310e6ca7b6bef0d3153-9fd9b4170c1a2c9b9ed1` |
| flick右PC1000×700 | `2310e6ca7b6bef0d3153-d775456e06eee353ab62` |
| flick上touch390×844 | `2310e6ca7b6bef0d3153-2d4d196e3488b2aea192` |
| flick下touch844×390 | `2310e6ca7b6bef0d3153-f0e5974eaf8ee676a47f` |
| flick左touch568×320 | `2310e6ca7b6bef0d3153-d607828b103b6407fdd9` |
| swipe右PC | `2310e6ca7b6bef0d3153-3c0bf6a940795292252a` |
| swipe上touch縦 | `2310e6ca7b6bef0d3153-2a366c2011c7b20ad640` |
| swipe下touch横 | `2310e6ca7b6bef0d3153-4a7b6730878bc69c3116` |
| swipe左touch短横 | `2310e6ca7b6bef0d3153-94fb1d2da45a0d44d90d` |
| warning／active／suspended／復帰／urgent／確定待ち／failure | `2310e6ca7b6bef0d3153-fa6ed090d54aa9adced6` |

`tests/browser/qte-ui-production.spec.js`の本番描画・0.5秒・予告入力拒否・拡大regionのnative操作・ソース再採点: `0fd00a4b862b88fc55d9-401c73e740399e724b85`。

### 画像／DOM／入力・時刻証跡

`test-results/local-qte-ui-final/`の各テスト配下に、`flick|swipe-<direction>-<profile>.png/.json`（8組）、`transparent-state-timeline.png/.json`、`production-fight-central-qte.png/.json`を保存。Playwright添付JSONにはnative入力・scoring evidence・前後snapshotもある。最終レポート・ID一覧と併せた引き継ぎarchiveは`/workspace/qte-ui-evidence.zip`（git外）。CIでも同じtestInfo添付を既存artifact保存経路で収集する。

本番証跡では、旧region x580.171875〜860.171875／y277〜417に対し、新region x140〜860／y174〜526。始点**(176,192)**から右へ80pxのnative mouse swipeはFIGHTパネル実矩形内かつ旧region外で、始点・終点ともhit targetは`scene`。25地点gridもすべて`scene`だった。active18156／deadline18656／cut18756ms、trusted pointerdown18169ms。予告時の入力は拒否され、次の描画フレームで開始する500ms窓内の操作だけ成功した。commitは1回。独立再採点も成功し、入力SHA-256は`9229d5a61936832057837227e031ce090a2ecf9d5706ca6edbe8590df26b096a`。

8方向ケースでも25地点ずつlive hit-testし、native操作を確認した。重なったDOMは入力を横取りしなかったため、入力制御・既存HUDの非表示／移動・追加回避レイアウトは不要だった。menuのmodal hit-testは既存のsuspend中だけ別扱いである。

### 最終変更ファイル（11）

- `src/ui/qte-layout.js`
- `src/ui/qte-hud.js`
- `src/ui/style.css`（冒頭QTE定義だけ）
- `tests/qte-layout.test.js`
- `tests/qte-hud.test.js`
- `tests/qte-operations.test.js`
- `tests/browser/qte-fixture.js`（QTE専用fixture）
- `tests/browser/qte-operations.spec.js`
- `tests/browser/qte-ui-production.spec.js`（新規）
- `docs/QTE_OPERATIONS.md`
- `docs/PHASE5C_QTE_UI_REFRESH.md`

## CI・残留リスク・終了境界

L2で提出する。全Regular A／B、Mobile34組／68画像、原本収集／実行IDの完全和集合、同一build artifact、base／HEADとvalidation merge二親、`ci-required`は未検証としてPMへ委任する。上記345件を将来Runの固定合格数として使用しない。比較器・capture・最終集約契約は無変更。

Chromium touchは実Android／iOSではない。OS文字描画・端末safe-area・アドレスバー／keyboard／実機pinch・hybrid機器の見え方はユーザーPMの実機受入が残る。targetは主pointer種別の単円なので、案内の32／40pxを併読する。明るい水面での半透明矢印／小文字の視認性は実機で最終確認が必要。本番WebGLケースは既存方式のDPR0.5で描画負荷を抑え、画質比較の代用にはしていない。短横のFIGHT文字やreticleとの視覚的重なりは承認範囲内。

PR提出後はCI完了待ち・監視・マージ・デプロイ・実機受入・5D／5E／5Fを行わず終了する。CI監査とマージ可否は9th_PM、実機受入と最終承認はユーザーPMが担当する。
