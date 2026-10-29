# Phase 5C-1 難航の事後検証（2026-10-30）

> 対象: PR #48 / FIGHT時計・入力・QTEドメイン、Mobile E2Eとci-required。事実・観測と原因推定を分ける。公開文書に裏設定を記載しない。

## 結論

5C-1は仕様自体の難しさに加え、**変更影響がゲームドメインから描画比較、さらにCI最終集約へ波及することを最初の変更契約で網羅できなかった**ために難航した。成功したUnitや一部E2Eだけではエンドツーエンドの検証経路の成功を証明できない。単なるCIの不安定性ではなく、異なる2層で再現性のある原因が検出された。

## 観測できた経過と証跡

| 段階 | 確認できた状態 | 対応 |
|---|---|---|
| 5C-0研究・ゲート | 近岸での長時間停滞、0.5秒3タップの困難、QTE失敗後の復帰が逆に有利になる106条件、fps勝敗差86群、有限配送期限の未決などが発見された。 | 開始距離補正、3タップ2秒、失敗後0.22秒arm、固定60Hz物理、厳密D境界等をG3 v0.5/v0.6で決裁。研究結果は本番実測に読み替えない。 |
| 5C-1初回提出 | Codexの一時作業ツリーではUnit 830成功/3失敗、局所E2E 43成功/3 timeout/5未実行、diff check失敗が報告された。研究工程の「本番編集禁止」の権限範囲も誤解され、PR未作成で停止。 | 5C-1承認と5C-0研究制限の適用範囲を明示し、同じCodexチャット内で修正継続。 |
| PR #48 / HEAD 254b384e | Actions run [40857333041](https://github.com/tk0mygit/barb/actions/runs/40857333041): Unit・Build成功、Regular E2E 219成功、Mobile E2E 57成功/1失敗、ci-required失敗。 | rotated-fightのcamera quaternion不一致を診断。 |
| PR #48 / HEAD 815f6324 | Actions run [40870881652](https://github.com/tk0mygit/barb/actions/runs/40870881652): Unit 851、Regular 219、Mobile 58が成功。それでもci-required失敗。 | 撮影側にはsource-backed比較を導入したが、scripts/ci-summary.jsが旧同期compareMobileCapturesを呼んでいることを確認。 |
| PR #48 / HEAD 9aae0282 | Actions run [40886048189](https://github.com/tk0mygit/barb/actions/runs/40886048189): Unit 854、Regular 219、Mobile 58、ci-requiredすべて成功。モバイル34組/68画像とE2E合計277件を最終照合。 | compareMobileCapturesWithSourcesのawaitを集約・アーティファクト検証・CLIまで伝播し修正。 |
| マージと公開 | PR #48をマージ、main 9524cd519c74eae88dc52a384c7a8dc9a096a0df。main run [40897018187](https://github.com/tk0mygit/barb/actions/runs/40897018187)でUnit/Build/ci-required/Pages deploy成功。main pushのRegular/Mobile E2Eは既定どおり未実行。 | ユーザー実機の釣り操作・描画受入は別ゲート。 |

## 根本原因と寄与要因

### 1. 物理変更とカメラ比較の依存関係が暗黙だった

FIGHTの押し戻しと正確なhold成立時刻により、同じタップ操作でも残距離・追従点・カメラ更新履歴が変わる。FIGHT追従カメラの実装自体は同一だった。初回Mobile比較は`rotated-fight`でmain/PRのカメラ姿勢の完全一致を要求し、物理的に意図された差異を描画回帰として拒絶した。実測ログでは追従点のZ座標や更新フレーム数が異なり、各実装SHAを使った同一履歴の再生ではそれぞれ正しい姿勢が得られた。対応は許容誤差の拡大ではなく、両SHAの独立再現と同一履歴での正規化比較に限定した。

### 2. 撮影ジョブと最終集約ゲートが別経路だった

Mobile E2Eの比較は独立ソース再生方式へ変更されたが、`scripts/ci-summary.js`の`validateMobileEvidence`が旧同期APIを呼んでいた。結果としてMobile単体58/58 PASSでも最終ゲートで同じ`rotated-fight`判定が再失敗した。後続修正では`validateMobileEvidence`→`validateAggregate`→`verifyArtifacts`→`writeSummary`→CLIの全呼び出し経路を非同期化し、拒否時はexitCode1とした。最終ゲートを単に通過させるだけのskipや比較無効化は行っていない。

### 3. 研究から実装への権限引継ぎが曖昧だった

5C-0の「本番編集禁止」は研究に限定されたが、5C-1開始時のCodexが同一プロジェクトの過去指示と衝突したと判断した。運用上は承認された**工程・許可操作・期限・優先文書**を明示し、以前の研究制限を実装禁止として持ち越さないことが必要。ただし承認されていない別工程へ自動的に権限を拡張しない。

### 4. 複雑なfixtureとローカル時間切れ

研究用の固定反例、ゲーム側の時計・入力、撮影時のFIGHT復元、比較器、集約ゲートが連動した。初回のローカルE2E timeout 3件の根本原因は**未確定**。CI本番の後続成功のみでローカルtimeout原因が完全に解決したとは断定しない。テストの省略や固定sleepによる隠蔽はしない。

## 工数影響

PR #48で同種のL2 Actionsを3回実施。各実行は概ね50分の壁時計に達しており、合計すると約150分相当のCI実行機会を要した（独立実行の合計であり、連続待機・実際のCodex稼働時間や課金額ではない）。先に比較コードと**最終集約経路をまとめて局所検証**することで、2回目の失敗は回避できた可能性がある。これは反実仮想であり、削減額の実測ではない。

## 恒久対策（正本: docs/CODEX_OPERATING_RULES.md）

1. Codex着手時に承認済み工程と旧工程制約の優先関係を明示する。
2. 変更前にゲーム状態→入力→描画→E2E撮影→比較→最終ci-requiredの**依存行列**を作成する。
3. 既定挙動の差は比較対象の契約で分類し、純粋な描画回帰と正当な物理状態差を区別する。例外は変更部分に限定して実SHAで再検証。
4. 比較関数の署名やasync化時は全呼び出し元・CLI・CI最終ゲートへ変更を伝播し、両経路を実ファイル相当のfixtureで検査する。
5. Unit PASSとE2E PASSと最終ci-required PASSを個別に記録。最後の集約での再検証を省略しない。
6. 修正は同じPR/同じCodexチャットで根因を固定テスト化して行い、再実行やassertion緩和で成功扱いしない。
7. 既存のL2分類、最新HEAD/検証用merge SHAの照合、マージ権限、実機受入の境界を維持する。

## 残るリスクと移行条件

- main ActionsとPagesジョブの成功は確認済み。実機操作・体感の受入はユーザーPM判定で別途記録する。
- 5C-2のDOM操作、有限受信cut/容量、ポーズ/復帰、旧釣果の保存と売却ボーナスは未実装。5C-1の成功を5C-2受入に読み替えない。
- 今回のCodex運用ルール変更PRは`AGENTS.md`を含むため、説明文書だけに見えてもL2対象。ユーザーだけがマージする。
