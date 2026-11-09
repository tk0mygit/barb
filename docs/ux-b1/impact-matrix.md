# UX-B1 実装前変更影響行列

作成：2026-11-09 JST。基準 main `cdd81b44b78d4ecdedde44e35e7fb13d9e9343db`。実装前の静的調査であり、以下の検証計画はPASS報告ではない。現行5入口のカード化と同一メニュー訪問内の戻りfocus/scrollに限定する。ヘルプ、QTE、ゲーム・保存・取引の意味、CI契約は変更しない。初回変更はL2。

## 直接・間接影響と不変条件

| 層 | 直接変更候補 | 間接影響 | 維持する不変条件・必要な検証 |
| --- | --- | --- | --- |
| ゲーム状態/確率/時計 `src/game/*` | なし | メニューopen/closeのpause結線がUI操作で使われる | phase遷移、時計・確率・QTE本来の時間を保持。menuの長時間表示でLURE/BITE/FIGHTを進めず、閉じた後にcatch-upしない |
| 入力 `src/input/*` / `src/main.js` | なし | 新button DOM・focus/scrollがnative inputの入口を変える | pointerdown時の購入許可snapshot、AIM取消、古いrelease/長押し解除、canOpen/RESULT制限、canvas focus復帰を保持。Tab/Shift+Tab/Enter/Space/native click/tapとEsc全閉じ |
| カメラ/描画 `src/rendering/*` / `src/world/*` | なし | UI面積が視覚上の遮蔽・撮影を変え得る | メニュー以外のcamera/renderer/safe/input geometryは変更しない。昼/夜/霧のカード視認、閉じた後の既存HUDを局所確認 |
| HUD/DOM `src/ui/collection-menu.js` | 5入口の表示定義とDOM/class、親scroll/起点focusのセッション内履歴、戻る/完了後focus | 未発見分岐・render/dispose・取引が同一controller内 | 順序・正規名称を保持、5入口のみ、補足別buttonなし、空helpなし。未発見の実名/画像URL/説明をDOM/ARIA/title/dataへ入れない。共通controllerをL1としない |
| collection dialogのHTML/CSS `index.html` / `src/ui/style.css` | collection部分だけのscoped card/layout/上部整理 | 保存全文・wallet・sale notice・画像root・dialog高さ/scroll・focus outlineへ影響 | 単一native dialog、戻る/×44px、root20pxの文字比例、2列/1列、本文のみ縦scroll、警告全文/role/status/ARIAと所持金を保持。QTE/釣果/共有HUDへ広域CSSを当てない |
| 保存 `src/ui/save-status.js` / save domain | なし（ノードの配置変更だけが候補） | 状態詳細の可視領域と読順、aria-describedbyへの接続 | saved/dirty/failed/unavailable/protected/conflict/backup復元の同じ文字列・意味・live/statusを保持。保存成功を捏造せず、schema/storage追加なし。全状態全文へscrollで到達 |
| 売価・売却・購入 `src/game/*` / collection controller | 取引処理そのものは変更なし。完了後focusのみ限定変更 | 消えた個体の起点/一覧位置と旧button再実行 | 個別売却即時、一括/購入確認、quote ID/現金/level/許可の再検証、pending単回消費、履歴/図鑑保持。取消/×/Escで無取引。消えたfocusは次/前の有効操作か見出し |
| 画像 `fish-image-loader.js` | なし | 新scroll/親復元がIntersectionObserverの領域・優先取得を変え得る | **#collection-contentを有効scrollrootとして維持**。先頭可視画像1件優先→最大2件並列、遷移/閉じdispose、古いdecodeがDOM/focusを復活させない。未発見はunknownだけ |
| 音 `sound-settings.js` / audio session | なし | サウンド画面への遷移・戻り頻度、focus/scroll復元 | 既存設定保存/ON/volume/retry、同一controlsを更新、遷移時unsubscribeを保持。メニュー停止と時間帯復帰はmain既存結線を変えない |
| 通知 `achievement-notice.js` / discovery / sales HUD | なし | 単一live regionのmodal host/ボタン位置・固定と本文領域の関係 | beforetoggle時の同一notice移動、ボタン位置/scroll/focus不変。新種可視3秒/Rare差、実績5秒/件・順序/取消/復帰を保持。売却通知の意味・期限を変更しない |
| Browser E2E | 新しいmenu責務spec、DOM変更に必要な既存selector/assertionの等価更新 | fixtureが読むindex/CSS、exact accessible name、画像/通知geometry | 既存検査を削除/skip/緩和しない。新規specはL2。共通diagnostics fixture、native actionability、retry0、既存timeoutのまま。新画面をfixtureだけでproduction検証済みと呼ばない |
| Mobile撮影 `mobile-performance.spec.js` / `mobile-capture.js` | なし | collection DOM/CSSの観測差が撮影条件へ及び得る | 34組/68PNG、品質/DPR/source provenance/IDを保持。実Mobile全撮影はPR L2 CIでPMが確認。ローカル未実施を成功にしない |
| 比較器/source再演算 | なし | 承認UI差と不変描画を分離して観測 | 閾値緩和・例外追加・camera/source再計算の省略なし。比較器の失敗をUI変更で隠さない |
| CI分類/分割/最終集約 | なし | 新specが完全inventoryとlane配賦へ加わる | L2全件Regular A/B/C+Mobile、動的収集/実行ID exact、run/attempt/SHAとmerge二親、artifact hashes、fail-closedを保持。分類器allowlist追加なし |
| workflow/CLI | なし | PR提出で既存CIが起動する | ci-required/Unit/Build、Pages条件、workers1/retry0維持。手動workflow/rerun/監視なし。PR URL報告後終了 |

## 実装前に固定すべきscroll/DOM境界

- `createCollectionMenu`の`content`は現在 `#collection-content`。renderで子を置換しscrollTop=0、実績購読再描画時だけscrollTopを復元する（collection-menu.js43-59/205-208）。
- `createVisibleFishImages(content)`は同じrootの矩形を直接測り、IntersectionObserver(root)を使う（fish-image-loader.js32-74）。**外側wrapperだけをscrollさせcontentをauto高さにする構成は、画面外画像を可視と判定するため不適切。** 画像モジュール変更へ拡張する理由にしない。
- 警告を本文と一緒に流すなら、`#collection-content`をscrollrootのまま維持し、共通説明/status/walletとrender対象を安全に分ける等の限定案を検討する。`replaceChildren`が共通status/ARIAノードを消さないことが必要。内部render先を変えた場合の既存selectorsも意味を保って更新する。
- `achievement-notice`はdialog直下へ同じnodeをbeforetoggleで移す。新wrapperへ取り込んだり、noticeを複製/初期化したりしない（achievement-notice.js13-24）。固定notice出現でbuttons/scroll/focusが変わらない既存assertionを保持する。
- `#collection-content > button`の旧exact text検査は `collection-menu.spec.js:23` と `achievements.spec.js:20` に存在する。カードに補足を足す場合、旧名称列を `.menu-entry-title`など新しい正しい子へ対応させ、件数/順序/名称の同じ主張を残す。単なる削除やcontainsへの弱化にしない。
- `#collection-content.scrollTop`を直接使う既存spec：mobile-layout、achievements、achievement-notice、equipment-ui。fish-image-loadingは同root矩形と各画像の可視判定をassertする。
- `#collection-wallet`のexact text、`#collection-sale-notice`の全文、`#collection-notice`の一時停止説明、`#collection-menu-note`の現在の文字/色/size/可視性は既存assertionあり。上部省スペース化で変更する場合は承認範囲とテストの意味を確認し、必要な情報や警告を落とさない。

## 推奨の局所検証（実行はrootが確定）

1. 必須の `npm ci` → 全Unit `npm test` → `npm run build`。依存/lockを変更しない。
2. 新menu専用spec全件＋ `collection-menu.spec.js`、`smoke-pc.spec.js`、`smoke-touch.spec.js`：5入口、native入力、pause/復帰、キーボード、短横/20px/safe、全状態警告の到達、focus/scroll。
3. `equipment-ui.spec.js`の確認/cancel/back/Esc/旧confirm/禁止phase訪問の主要ケース、`fish-sales.spec.js`の個別/一括・quote単回消費：同controllerの戻り処理変更に対する取引退行を確認。
4. `fish-image-loading.spec.js`の一覧/保管可視優先・scroll・detail・close後decode、`audio.spec.js`の設定/保存・menu pause/復帰：scrollrootと購読/dispose維持を確認。
5. `achievement-notice.spec.js`のmodal moves preserve viewport/layout/scroll/live text、`achievements.spec.js`の未解除秘匿/進捗scroll、`mobile-layout.spec.js`の短横/拡大字/回転：新header/scrollが通知host・操作対象を動かさないこと。
6. `autosave.spec.js`の警告/競合/保存不可の代表、`species-discovery.spec.js`の3秒/Rare/即時結果操作・取消：保存全文と通知契約を既存assertionで確認。

局所対象の選択は実際の差分・収集IDから最終確定し、実件数/初回失敗/修正/未実施を記録する。全件ローカルE2EやCI待機を要求しない。動的ID集合/実Mobile34組・68PNG/新PR実merge二親・ci-requiredは最新HEADのPR L2でPMが確認する。
