# UX-B1 メニュー検証記録

基準main: `cdd81b44b78d4ecdedde44e35e7fb13d9e9343db`。Phase UX+P-5 / UX-B1。

既存5機能を承認済み案Aのカードへ変更し、同一メニュー訪問内の親scroll・起点focusを復元する。公開入口は図鑑、生けす、ギア／アップグレード、実績、サウンド設定の5つ。完成ヘルプを加える最終6入口はUX-B2で扱う。

## 変更境界

- 主要4カードは深緑、サウンドは低彩度ブルーグレー。既存名称をaccessible name、補足をaccessible descriptionとして分離し、カード全体が単一button。
- `#collection-content`を唯一のnative scroller/画像observer rootとして維持。その内側に共通情報と動的`#collection-view`を分離し、保存全文・live/status/ARIA・所持金の既存ノードを保持する。
- 戻る/×は本文外で44px以上。親位置は安定した操作キーとscroll値だけを同一訪問内で持ち、閉じると破棄。再openはトップ先頭。消えた売却対象は次/前の有効操作か見出しへfallback。
- 取引quote/canPurchase/単回消費、画像decode/音声購読破棄、mainの入力解除と時計停止、ゲーム/QTE/通知/保存schema/CI契約は維持する。

## 本番ビルドの画面証跡

PNGと`ui-observations.json`は実際のUX-B1本番ビルドをsystem Chromiumで表示した記録。DPR1、reduced motion、touchはエミュレーション。静止画の入口操作は一時的なUA tap highlightを避けるtrusted mouse clickで、native touch操作は別のBrowser assertionsで検証した。UX-Aモックの完成画像や物理端末での合格を示すものではない。

| 条件 | 先頭 | 補助証跡 |
| --- | --- | --- |
| PC 1280×800 | [PC](pc-menu.png) | 2列・5枚。ヘルプ用の空button/ダミーはない |
| touch相当390×844 | [縦](touch-menu.png) | 1列・5枚 |
| 568×320/root20px/safe上下8・左右12px | [短横](short-menu.png) | [中間](short-equipment.png)、[末尾](short-sound.png) |
| 同短横・保存容量不足 | [警告全文](short-warning-menu.png) | [警告後の末尾](short-warning-sound.png) |

保存容量不足の画像はテストContext内で既存Storage書込みにQuotaExceededErrorを返す故障注入。保存状態を成功へ置換せず、製品の通常autosave経路で表示された警告全文を確認した。写真の金額・保存時刻は実際の表示で、モック固定サンプルをコピーしていない。

承認モックとの意図した違いは、B1の5枚構成、既存補助文の保持、上部の共通説明/所持金/保存全文を本文scrollへ含めた点。警告が長くても固定の戻る/×を押し出さず、末尾の機能へ到達できる。

## 局所検証の境界

詳しい実行数と最終HEADの結果はPR本文を正とする。新規メニューspec、既存メニュー/両smoke、保存/売却/装備/画像/音/通知/回転の選択ケースを検証した。新規保存表示テストは実save-statusを使うUI fixtureであり、実保存の全故障条件を再現したという意味ではない。

初回の全Unitでは1183/1184件が通過し、既存のMobile source provenance検査1件が未commitの`src/ui/`変更をHEAD不一致として拒否した。検査は変更していない。最終のSHAに対応する全Unitの結果はPR本文を参照。

初回Browserは旧UIを返す既存previewの再利用と途中の接続断で6件が失敗した。現在buildの再生成/新しいpreviewで解消を確認。新規specの短横native pan直後のタップはflingを止める入力に消費され、照明は250ms進行後の描画と保存時刻を誤比較していた。前者は実scrollendを待ち、後者は最初の描画を保存時刻と厳密比較するようテストを修正した。sleep/retry/timeout/判定精度・既存assertionを緩めていない。旧失敗記録は局所検証の証跡に保持した。

実機、PRの実L2、Regular A/B/C＋Mobile全件、Mobile34組/68画像、実validation merge二親とci-requiredは本記録の局所成功とは別。ユーザーPM/15th_PMがPRの最新結果を確認する。CodexはPR提出後にCI待機・監視・rerunをしない。

## PM向けの確認手順

1. 停船してメニューを開き、5枚の名称・補足とサウンドだけの補助色を確認する。
2. サウンドへ移動して戻り、起点カードと一覧位置へ戻ることを確認する。発見済み図鑑詳細・購入確認cancelの戻りも確認する。
3. ×/Escでゲームへ戻る。再openは先頭で、確認画面を復活させない。縦横/拡大文字でも本文をscrollし、末尾と戻る/×へ到達する。
