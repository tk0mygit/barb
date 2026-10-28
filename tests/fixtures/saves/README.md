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

## 昼夜・main/PR比較の共通初期値

`lighting-save-v1.json` は同じ変更前mainの `createSaveData()` が出力した正規v1です。
空の釣果・財布0・両装備Lv.1・旧実績空、船(10,20)、heading 0、時計270秒、
savedAt `2026-10-23T00:00:00.000Z` を公開ドメインAPIで組み立てて固定しました。
`tests/helpers/lighting-save.js` は時計だけを指定値へ置き換え、main/PR両方へ同じデータを渡します。
PRの新しいシリアライザを旧main用fixture生成に使いません。

`tests/lighting-save.test.js` は固定SHAの旧ソースをGit archiveで一時ディレクトリへ読み、
実際の旧保存検証・ストレージ復元で各初期時計と船を確認します。PRの復元、通常保存の新契約、
旧原文の非破壊性も確認します。ブラウザfixtureも最初の実描画で復元済み状態・船位置・時計を
検証し、保存拒否による新規状態へのフォールバックを比較に使わせません。
