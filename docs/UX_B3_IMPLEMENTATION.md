# UX-B3 案A 実装記録

## G0: 権限・基準・変更影響

2026-11-10のユーザーPM実装GOを適用する。設計資料の実装不可/欠落補完STOPは撤回済み。
この既存調査チャットに実装指示が届いたため、このチャットを継続する。モデル/思考設定は変更しない。
GitHub main API、remote ls-remote、fetchしたorigin/main、checkoutはすべて
`05dd8fcb45726cbbfe439d43c89f295f5affac93`。開始時worktreeはclean。
専用ブランチ: `codex/ux-b3-hud-a`。初回L2、単独PR。PR提出後CIを待機・監視しない。

設計資料は`/workspace/ux-b3-audit`に存在するが、その完全収録を受入の証明には使わない。
実装と採取済みJSON・native入力から必要な状態を再検証する。実機は未確認。

| 層 | 直接変更の候補 | 間接影響と保持する検証 |
| --- | --- | --- |
| 状態・確率・時計 | 変更しない | HUD矩形がcast可否/回収へ波及。phase/距離/heading/時間を実入力で検証 |
| 入力adapter | 変更しない | ボタン/capture/cancel/disabled、canvasへのnative hit |
| カメラ・描画 | 変更しない | FOV55、回収全経路、追従姿勢、DPR/buffer/resourcesは厳密一致 |
| HUD/DOM | CSS中心、必要な静的wrapper | ID/role/label-for/live/ノード同一性、親bboxと実paintを測る |
| cast visibility/main | 変更しない | 空白を含む`.action-panel`等の親矩形を除外せず8/28/32/40m・方向・岸を検証 |
| 通知 | CSS、必要なら最小の位置調停 | 全文/寿命/順序/取消/hostを保持し、READYとcast中の重複を測る |
| QTE | HUD/geometry/delivery/clock/evaluatorを変更しない | 本番領域、円/矢印/timer、0.5/1/1.5秒等、canvas hitと中断/再開 |
| 保存・売価・魚種・画像 | 変更しない | save状態、売却/保管、未発見秘匿、decode/取消/画像監査 |
| E2E撮影・比較 | 承認HUDのID/fieldに限定 | exact source blob/base/validation SHAと独立した実DOM測定を結びつける |
| ci-required/CLI | 既存経路を維持 | 撮影→同じ比較関数→最終再検証→CLI拒否/非0終了を追跡 |
| 分類・workflow・依存 | 変更しない | 初回L2。34組/68画像・全選択ID・artifact照合を維持 |

## 比較のデータ経路

`tests/browser/mobile-performance.spec.js`が両SHAのproduction buildを撮影し、
`mobile-capture.js`の実測layoutとsource metadataをraw JSONへ保存する。
`scripts/compare-mobile-performance.mjs`のsource付き比較をafterAllとCLIが使用する。
`scripts/ci-summary.js`の`validateMobileEvidence`も同じ比較を再実行し、原画像・個別JSON・
metadata・artifact hashと34組の結果を照合する。片側だけの例外追加は行わない。

## 実装・検証結果

作業中。最終の変更範囲、H01〜H05、各拡大方法、局所結果、未実施事項をここへ追記する。
