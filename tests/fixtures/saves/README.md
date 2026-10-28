# Phase 5B-1Aの旧セーブ固定fixture

`phase5b1a-legacy-slot-a.json` / `phase5b1a-legacy-slot-b.json` は、変更前の
main `ae8c44678aea374b03755b182e722406e542e53a` の公開ドメインAPIで生成した
正規v1スロットの生文字列です。新実装で旧形式を組み立て直すfixtureではありません。
実ユーザーのセーブデータは含みません。旧セーブfixtureは元のリポジトリにありませんでした。

変更前の `createFishing` で乱数・日時を固定し、prepare→cast→hook→fight→landing→resultを
100回実行しました。12魚種を順に捕獲し、1匹を保管、残りを `sellResult()` で売却。
`purchaseUpgrade()` でAはロッドLv3／リールLv2、Bは両Lv5にし、
`createSaveData()` / `createSaveStorage().save()` が出力したgeneration 1／2を保存しました。
Bは旧10実績をすべて取得済みです。船・時計・遭遇条件・過去売価・解除日時も含みます。

テストはファイルから再読込し、以下のSHA256、旧実績日時、履歴、財布、装備、船、時計、
初回loadでのA/B原文不変と次回通常保存の新契約移行を確認します。

| ファイル | SHA256 |
| --- | --- |
| A | `99d6efd2be174cef0b7ad627e9f7d435706aad3540ab4fe759be7ef4b839a6de` |
| B | `157bdfdd78993ce9a11226f0540fe6a2d9658c4b0e763194b1d61d668c8b1980` |

既存互換の根拠として原文を固定し、実装変更時に再生成・ハッシュ更新しないでください。
