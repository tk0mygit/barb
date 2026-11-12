# Sky-4 / PR-D2: Aurora motion visibility

2026-11-12のユーザーPM承認による視認性微修正。既存チャットを継続し、
`8986d7d06b5742f0cd0788dc5fc6d2ea8f4d0190`（#82マージ後）から別ブランチ・別PRを作成する。
L2。マージ・デプロイ・実機受入はPMの判断とする。Sky-5の機能は追加しない。

## 変更と不変条件

製品差分は`src/world/aurora.js`の定数と境界球だけ。

| 項目 | base | motion tune |
| --- | ---: | ---: |
| 両shaderの時間係数 | 0.00872664625997 | 0.03490658503988（4倍） |
| X / Y変位上限 | 28 / 18 m | 45 / 29 m |
| foldの2振幅 | .022 / .009 | .031 / .013 |
| hemの2振幅 | .055 / .035 | .077 / .049 |
| 境界球の変位余裕 | 48 m | 80 m |

時間係数は元の4倍で、tの2/3/4倍の波は90/60/45秒周期。
720秒wrapの整数周期を維持する。最大変位のL1上限は45+29=74mで、80mの余裕が上回る。
波の向きと層間の位相差は維持する。色・alphaの式・15秒fade・抽選20%・salt・時計・保存は不変。
geometry/attributes/index、2 Mesh・共有Geometry 1・Material 2・GPU Program 1、
最大2 calls/3,200 triangles、3 immutable GPU buffers、Texture差0を維持する。

## 影響と検証経路

| 境界 | 直接変更 | 間接的な観測差・確認 |
| --- | --- | --- |
| ゲーム状態・抽選・時計・保存 | なし | 各SHAのsource一致、既存分布/RNG/魚/QTE/save Unit |
| 入力・カメラ | なし | PC/タッチの通常入力、カメラpose一致とsource replay |
| Aurora描画 | 定数と境界球 | 時系列画素・裾/光条、球内包含、反対視点の実submission 0 |
| 星・流星・霧・月・地形/水/木 | なし | source/blob不変、両カメラの既存sky draw、ON/OFF画素 |
| HUD/DOM・釣り | なし | 既存スモーク・代表操作、画像の前景保護 |
| E2E撮影 | 専用A/B specを追加 | 同じ通常保存時計、native初期poseの固定診断カメラ、実描画4時点 |
| Mobile/景観比較 | 専用transitionへ明示的にdispatch | 固定/実カメラを各SHAから独立再生、資源差をsource計算 |
| CLI・ci-required | 呼び出し先の比較器を更新 | 既存await経路・全ID/34組68画像/artifact/SHA/hash条件を保持 |
| workflow・selector・設定/依存 | なし | 既存L2全件、timeout/retry/workers/DPRを維持 |

`sky4-source.js`・`sky4-source-pins.js`と導入時のfixtureは初回導入の原典として保持する。
新しい`sky4-motion-source.js`とliteral `sky4-motion-pins.js`は、上記baseだけを受け付ける。
完全SHA、validation mergeのbase/HEAD親、最終blob、src差分1ファイル、独立した行置換で
全ての許可差分を照合する。旧shader/alpha/抽選/buffer/他のsrc、歴史的helper/observerの変更を拒否する。

撮影は既存の`verifyAuroraCapture`を用い、比較器は`readAuroraTransition`から新遷移へ到達する。
両版の時計・天候・factoryを`git show`から独立importする。boundingSphereの差も各版の
frustum replayへ反映する。旧Sky-2/3の加算を重複適用しない。
`compareMobileCapturesWithSources`→比較CLI→`validateMobileEvidence`の既存await経路を保つ。
合成Unitの34組/68画像完全性検査は実CIの成功とは区別する。

## 画像の読み方と測定

専用`aurora-motion.spec.js`は、同じ通常当選CLEAR保存・boat・viewportを両版に与える。
PC TPS/FPS、390×844・844×390・568×320のタッチTPS/FPSを採録する。
通常入力で得たnativeカメラposeを複製して診断撮影だけに固定し、実ゲーム時計は250msずつ進める。
同じ構図の0/2/5/10秒を実レンダリングし、ON/OFF/個別層PNG・uniform/GPU JSONを保存する。
HTMLは静的4列。上下の同じ列が同時刻A/B、各段が各版内の時系列である。

時間変化量は各時点のON−OFFによるAurora寄与と、その版の0秒時点の寄与の差。
水面や星の時間変化を動きの数値へ混入させない。画素差の大きさだけで美観を保証せず、
元解像度の画像で穏やかな波・色・空との馴染みを確認する。
下部60%への寄与0、白飛び0、月の明部差0、2層それぞれの寄与を既存基準で検査する。
昼・霧・非当選はA/Bの画素とcold GPU資源を完全一致させる。

PC高DPR/モバイル負荷は既存Mobile captureの同条件A/B、shader/資源は実submissionと独立replay、
gzipは同じlocked依存・同じ圧縮条件で測る。Chromium/SwiftShaderのCPU/同期窓を実機FPSへ換算しない。
実測値、実行SHA、初回失敗・未実施項目はPRとレビューZIPに記録する。

## 提出・STOP

局所Unit/Build/E2Eを実施してから新PRを提出する。元のPR #82は変更しない。
全L2実CI・34組68画像・ci-required、実機・正式な視覚受入はPMの判定が必要。
source逸脱、予算超過、描画/乱数/保存の回帰、未解決timeout、視認性不足があればSTOPする。
push/PR提出後のCI監視・polling・rerun、マージ・デプロイは行わない。
