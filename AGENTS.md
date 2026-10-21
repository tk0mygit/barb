# BARB development rules

- Vite + Three.js + JavaScript ES Modulesを使用する。
- `src/world/` はマップ・環境、`src/game/` は描画に依存しないゲーム状態、
  `src/input/` は入力、`src/rendering/` はモデルとカメラ、`src/ui/` はDOMとCSSを担当する。
- 状態の更新は時間差分（秒）に基づける。フレーム依存の移動や停止判定を避ける。
- PCのマウス・キーボードとスマートフォンのタッチを維持する。
  pointercancel、フォーカス喪失、画面非表示時には入力を解除する。
- モデルと素材はfactoryの境界で交換できるようにする。有料素材は使用せず、
  将来の外部素材にはライセンスと出典を記録する。
- 釣りシステムの追加は別タスク。現在の釣りモードは視点切り替えのみ。
- 公開README、UI、PR説明にゲームの隠し設定・ネタバレを記載しない。
- Viteのbaseは `/barb/`。追加素材のURLはimportか `import.meta.env.BASE_URL` を使用する。
- 変更後は `npm test`、`npm run build`、操作に影響する場合は `npm run test:e2e` を実行する。
  テスト未実行・失敗・実機未確認は明確に報告する。
- lockfileをコミットし、CIでは `npm ci`。秘密情報・生成物・node_modulesをコミットしない。
- 既存の作業を保持する。クラウドタスクでは既存チェックアウトを使用し、
  ユーザーの指示なしにGit worktreeを追加しない。
