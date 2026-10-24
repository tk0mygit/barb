# BARB development rules

- Vite + Three.js + JavaScript ES Modulesを使用する。
- `src/world/` はマップ・環境、`src/game/` は描画に依存しないゲーム状態、
  `src/input/` は入力、`src/rendering/` はモデルとカメラ、`src/ui/` はDOMとCSSを担当する。
- 状態の更新は時間差分（秒）に基づける。フレーム依存の移動や停止判定を避ける。
- PCのマウス・キーボードとスマートフォンのタッチを維持する。
  pointercancel、フォーカス喪失、画面非表示時には入力を解除する。
- モデルと素材はfactoryの境界で交換できるようにする。有料素材は使用せず、
  将来の外部素材にはライセンスと出典を記録する。
- Phase 1（湖・操船・カメラ）とPhase 2（キャスト〜釣果画面）は実装済み。
  既存の釣り操作・状態遷移を維持し、後続機能は依頼範囲に限って段階的に追加する。
- 公開README、UI、PR説明にゲームの隠し設定・ネタバレを記載しない。
- Viteのbaseは `/barb/`。追加素材のURLはimportか `import.meta.env.BASE_URL` を使用する。
- Codexは変更後に `npm test` と `npm run build` を基本検証として実行し、
  必要に応じて関連E2Eを局所実行する。ローカル全件E2EはPR提出条件にしない。
  テスト未実行・失敗・実機未確認は明確に報告する。
- 全件E2EはPR上のGitHub Actionsが実行する。Codexは局所検証結果と未解決事項を
  PRへ記録し、PR URLを報告した時点で終了する。CI完了待機・継続ポーリングは行わない。
- P3-A時点では文書のみを含む全PRで全件E2Eを維持する。PRの検証チェック名は
  `ci-required`。単体テスト・ビルド・全件E2Eを同じジョブで検証する。
  mainへのpushでは `npm ci`・単体テスト・ビルドを実行し、全件E2Eは繰り返さない。
  Pages成果物とデプロイは `push` かつ `refs/heads/main` に限定し、マージ後のmainから
  生成したdistを使用する。手動全件検証はmain指定時もデプロイしない。
  L0／L1／L2の選択実行とscheduleは未導入で、P3-Aのマージ・デプロイ確認後のP3-Bで扱う。
- PMがCI結果と差分を確認し、CI失敗時は同じPRのCodexスレッドで修正を指示する。
  最新HEADの `ci-required`（全件E2Eを含む）が成功し、PMが差分を確認するまでマージしない。
  マージはユーザーだけが実施する。そのmainへのpushを受けてGitHub Actionsが自動デプロイし、
  PMがE2Eの設計上の省略とビルド・デプロイ成功を確認する。ブランチ保護は無断で変更しない。
- テスト削除、assertionの削除・緩和、根拠のないタイムアウト延長・リトライ、
  固定sleepの増加、強制操作・状態注入による失敗隠蔽は禁止する。
  詳細な検証・診断手順は `docs/TESTING_WORKFLOW.md` を参照する。
- lockfileをコミットし、CIでは `npm ci`。秘密情報・生成物・node_modulesをコミットしない。
- 既存の作業を保持する。クラウドタスクでは既存チェックアウトを使用し、
  ユーザーの指示なしにGit worktreeを追加しない。
