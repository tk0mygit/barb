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
- PMがCI結果と差分を確認し、CI失敗時は同じPRのCodexスレッドで修正を指示する。
  最新HEADで全件CIが成功し、PMが差分を確認するまでマージしない。
  マージ・デプロイはユーザーだけが実施する。
- テスト削除、assertionの削除・緩和、根拠のないタイムアウト延長・リトライ、
  固定sleepの増加、強制操作・状態注入による失敗隠蔽は禁止する。
  詳細な検証・診断手順は `docs/TESTING_WORKFLOW.md` を参照する。
- lockfileをコミットし、CIでは `npm ci`。秘密情報・生成物・node_modulesをコミットしない。
- 既存の作業を保持する。クラウドタスクでは既存チェックアウトを使用し、
  ユーザーの指示なしにGit worktreeを追加しない。
