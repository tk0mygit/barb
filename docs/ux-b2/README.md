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

実行結果・失敗履歴・画面証跡・残存リスクは実装と検証後に追記する。
