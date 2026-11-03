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
