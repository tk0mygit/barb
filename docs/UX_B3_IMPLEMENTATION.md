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

## 採用した表示と変更境界

案A。湖全体の描画は維持し、ヘッダーに既存HUDと同系の濃緑背景と薄い輪郭を追加した。
状態20px、本文14pxを通常の基準とし、テンション警告と状態の階層を明確にした。
文字色・通知本文・操作説明は従来のものを使う。ルアー名4個と選択状態を残す。

製品の変更は`index.html`、`src/ui/style.css`、`src/ui/cast-notices.js`の3ファイル。
`fishing-note`を同じIDのまま独立した静的`.action-panel`へ移した。ボタンのノード・ID・
role・label-for・live・disabledの更新処理は維持する。この新しい親も、変更していない
mainの遮蔽矩形収集に含まれる。遮蔽判定から除外するためのwrapperではない。

`main.js`、釣り状態/確率、入力、カメラ/FOV、cast-visibility、QTEのHUD/geometry/delivery/
clock/evaluator、保存、価格、魚種、画像資産、メニュー6カード、ヘルプ4節、共通glyphは変更していない。
変更ファイルの全一覧はPR差分を正本とし、比較器・期待矩形・そのUnitと局所E2Eを付属する。

## H01〜H05と実DOM

座標はCSS px。短横の下表は568×320・computed20px・safe上下8/左右12。
比較前の測定はmain `05dd8fc…`、比較後の製品source treeは
`9dc87e7865871c341711ae141ae02ae3ca05f3f9`。すべてブラウザエミュレーションで、実機合格ではない。

| 問題 | 原因と是正 | 実測・入力確認 |
| --- | --- | --- |
| H01 READY | 旧picker `(308,16,236,156)`がmenuを覆っていた。短横を2×2にし、名前と選択状態を維持 | 新picker左上 `(12,208)`、各146×44。menu `(508,18,48,48)`。4ルアーとmenuの中心hit、native tap、aria-pressedを確認 |
| H02 AIM | 旧情報 `(24,84,320,124)`、操作親 `(384,84,160,277)`が水面と画面外まで占有。情報と操作を上段へ、noteの親を分離 | 情報 `(24,60,520,50)`、操作親 `(24,111,520,44)`。BITEは情報高52、操作開始113。実親矩形を保ったままcast可能 |
| H03 FIGHT | 旧短横の縦266pxのHUDがheaderへ伸長。条件を上の独立行、状態/距離/テンション/警告を下の主帯へ | 主帯 `(24,212,520,52)`、条件 `(24,76,520,30)`、無効の戻る `(24,16,176,48)`。この短横FIGHTだけwordmarkを非表示。menu/wallet/実保存表示を保持 |
| H04 QTE | 旧HUDと円、旧戻るとtimerが重なっていた。QTEは固定し、HUD位置をsafe領域の中心に合わせる | 568/844の4操作と844通常文字をnative touchで検証。縦矢印・円・timer・文字の実paintに干渉なし。判定領域の端を含む45点×9ケースでhitがscene |
| H05 縦通知 | 旧spot `(198.59,90,169.41,57)`とsale `(22,100,346,69.19)`が重複 | READYのsaleを下へ分離。縦/通常短横/短横20pxの3通知、最長本文、保存失敗表示と回収noteを検証。寿命・順序・取消は維持 |

通常844×390のFIGHTは主帯`(22,249,800,50)`、meter幅198px、戻る`(22,16,176,48)`。
20px/safe8/12では主帯`(24,247,796,52)`。中央QTEのtimer位置から8px以上の間隔を確保する。
通常の戻るも44px以上とし、hoverによるmenu/操作ボタンの移動を抑えた。

### castと親矩形

24ケースで通常文字/root20px/computed20px、rod Lv1/5、4ルアー、中央と左右の最大角を検証した。
8/28/32/40mの予測、native release、LURE到達と回収を含む。目標の短横でFOV55を維持する。
さらに86のAIM予測の採取済みcamera/target/全親矩形から、変更していない`createCastVisibility`を独立に再実行し、
86/86で有効を確認した。root20pxの中央40mも追加でrelease→BITE→本来のアワセ遅れ→READYまで検証し、表示変更による回収と混同していない。`cast-feasibility.json`に元JSONへの対応、遮蔽親、距離、結果、algorithm blobを収録する。

root20pxでは見出しが25pxとなり、computed20pxと同じではない。初回には40mで操作親の下端161pxが
遮蔽判定に入り、4ルアーで失敗した。帯間隔を4→1pxとして下端158pxへ移し、既存12px+0.05pxの判定を維持した。
通知が表示されたときだけ現れるnoteの実親も収集する。空の子を含む親を検査から外していない。

### 通知調停の限定変更

CSS分離だけでは売却後の短横で再キャストできなかったため、許可範囲の位置調停を加えた。
既存の探索、6000の探索予算、8px間隔、12px+safeの外周、実測reflow、fallbackは維持する。
非castの実ゲームHUDにも既存placerを適用し、狭いFIGHTでは同じ実績ノードを位置探索へ含める。
READY/FIGHTの空いたheader中央は実際のwordmark/header-toolsとボタンを避けて利用する。
QTEの円/矢印/timer/文字も障害物とし、tap進捗は透明な判定領域全体ではなく実文字のRange矩形を保護する。
通知モジュールの時計・FIFO・host・本文・金額・取消は変更しない。

複合通知の長文/保存警告は、実UIモジュールと公開domain APIによるUI fixtureで検証した。
このfixtureには本番のゲームループ/rendererがないため、物理入力やQTEの合格証明には流用しない。
本番QTEは別に実main loopとnative入力、source replayで検証し、point通知も同時に表示する。
最大3通知と最長警告を含む全状態・全QTE・全文字条件の直積を網羅したとは扱わない。

## mobile比較の最小契約

`mobile-hud-a.js`はbase SHA `05dd8fc…`、両側の全`src` tree、CSS/index blob、lock/vite blobを固定する。
Gitから両SHAを再読込し、base/HEAD/validationの祖先関係、検証mergeの親順を従来どおり検証する。
期待値はcaptureが自称する値ではなく、review対象の`mobile-hud-a-layouts.json`に両側の矩形を固定する。

| capture ID | 差を認めるfield（両側とも完全一致が必要） |
| --- | --- |
| portrait-bite / small-bite | panel、occupancy、buttons |
| landscape-bite / pc-bite | panel、occupancy |
| portrait-fight / small-fight / pc-fight | panel、occupancy、meter、buttons |
| landscape-fight / rotated-fight | 上記4 fieldとheader |

viewport、reticle、notices、overflow、状態/警告/テンション/条件、pointer/hitは従来の厳格検査を保持する。
全IDのカメラ、FOV、DPR、buffer、pixels、resourcesとactualResourcesに余裕を追加しない。
無関係なcapture ID、別source tree、別base、画像/個別JSON欠損へ例外を拡げない。
PNGを一律更新する変更や、全画面の差分率を丸めて成功にする変更はない。
旧経路はPNG保存・欠損検査とraw描画/HUD計測の比較であり、PNG全画素の一致を新たに主張しない。

撮影afterAll、CLI、`ci-summary.js`の最終再検証は同じ比較関数を使う。
最終ゲート/CI分類/workflowの変更はない。34組/68PNGと個別JSONの完全性条件を保持する。
9本の追加Unitは34組の**合成fixture**で正常系と改竄/欠損/別SHA/別source/merge親順/CLI非0終了を検証する。
これを実CIのPASSへ読み替えない。

## 局所検証・証跡

Linux Chromium 154.0.8037.57、Playwright 1.64.1、Node v24.19.0、SwiftShader。
source treeを各段階で照合して順次実行する。`validation-results.json`がコマンド/終了値/時間の索引。
native入力の局所specはDPR0.5を使う。比較撮影は既存profilesのDPR1/2/3、overview撮影はDPR1。
CSS座標とPNG画素寸法を同一視しない。
主要測定はHEAD `83e6992`で固定した。以後の変更は実装記録と追加の回収理由assertionのみで、
製品source tree `9dc87e7…`・index/lock/vite blobは同一。検証mergeの成功は未確認である。

| 検証 | 結果 |
| --- | --- |
| npm ci | 成功。依存/lock変更なし |
| Unit / Build | 1197/1197 PASS、skip 0（131.636秒）。Build PASS、102 modules。既存の500kB超chunk警告あり |
| native・cast・通知・回転・QTE | 44/44 PASS。3フォント×2 Lv×4ルアー、UI複合通知9、QTE9、既存mobile-layoutと本番QTEを含む。回収理由まで強化した4件の再検証もPASS |
| 独立cast計算 | 86/86 valid、FOV55、実親矩形と元JSON付き |
| mobile局所比較 | 20/20テストPASS。6描画＋9 HUDの15実ペアをsource付き比較。34組全件は未実施 |
| fishing/spots/help/menu/QTE/smoke | 基本釣り・points 9件＋連続7種の1件PASS、別選択のhelp/menu/QTE/smoke 39/39 PASS。全36種連続群は途中停止しL2 CIへ残す |
| fish-assets | 初回15件中14件PASS、desktop画像監査1件NG。後述。既存spec/分類の変更なし |
| 朝/昼/夜/霧・拡大 | 7 profile・61 PNGを採取、pageerror/console error/requestfailed 0。通常/root20/computed20でnative 40mを個別確認。Chromeページズーム200%でもREADY/AIM/BITE/FIGHT/QTEへ到達 |
| git diff --check / L2分類 | diff --check PASS。既存classifierでL2、全inventory選択。CI/実機は未実施 |

拡大は次の別条件で測った。568×320の3条件はsafe上下8/左右12、DPR1。

| 条件 | root / 状態のcomputed値 | 実測 |
| --- | --- | --- |
| 通常文字 | 16 / 20px | AIM操作親y=103.797、高44 |
| root20px | 20 / 25px | AIM操作親y=114、高44 |
| computed20px | 20 / 20px | AIM操作親y=111、高44 |
| Chromeページズーム200% | root16 / 状態20px、DPR2 | nominal content 1280×800、CSS viewport640×400、visual scale1。CSS zoom/文字上書き/viewport overrideは使わずChrome設定で200%を選択 |

最後の条件をOS文字拡大、スマホpinch、全UI20pxと同一視しない。

同梱する証跡は、`mobile-release/`のbase/PR PNG・raw JSON、`attempt-final/`の代表状態、
`native-release/`の投影/入力/QTE幾何とPNG、`cast-feasibility.json`、`zoom-200/`、
実行ログ、計測スクリプト。画像はモックではないが、すべてブラウザ観測である。

### 初回失敗を消さない

- sandboxのGit子プロセスEPERMと参照過去SHA未取得を解消してUnitを再実行した。次の1件は
  未commit runtimeを検出する既存のprovenance検査で失敗し、sourceをcommitして解消した。
- UI fixtureのルアー選択後の再描画不足を修正した。ゲームループがある本番への状態注入は加えていない。
- 狭幅通知、headerとsafeの間隔、meter幅188.9→198px、root20pxの40m拒否を実測して是正した。
- 2 CPU環境で描画を並行しすぎ、既存resource/QTE specにもtimeoutを出した。ログ/traceを保持し、
  描画を順次実行へ変更した。timeout/retry/skip/assertionは緩和していない。
- 撮影途中のビルド更新を含む`mobile-01`、途中停止した`mobile-02`は最終比較の証跡に使わない。
- 旧実績anchorのfixtureへCSSが及んだ失敗を、実ゲームphaseへのselector限定で修正した。
- 追加拡大計測の旧形式セーブではLv5の初期条件を作れていなかった。既存cast specと同じ公開APIでV3初期セーブを作り直し、3条件とも40m releaseを再確認した。
- 実行環境の再起動で関連specが途中停止した記録を保持する。全36種の長い連続群はローカル選択を縮小し、L2 CIで全件を維持する。

### 画像監査NGを受入保留として引き継ぐ

desktopの36 PNG監査で`arctic-char.png: net::ERR_ABORTED`を検出した。
失敗したRequest 61は2026-11-10 05:34:28.331 UTCに開始し、ネイティブ遷移によるsrc除去は
同28.3395〜28.3441秒、失敗通知は28.400秒だった。監査が遷移開始時に固定するRequest IDはnull。
同じDOM画像のbefore/afterとtrusted clickは記録されているが、既存の取消認定条件を満たせないためNGを保持する。
同URLの後続Request 62/80/115の成功は、このNGの取消根拠にしない。

基準mainの1回の対照UI観測では36件のdecode/hash照合とimageErrors=[]まで進んだが、
後段のartwork reportが未ビルドdistのENOENTで終了した。baseline全specのPASSではない。
PR #76の事象との同一根因は未確定。PNG/loader/画像監査specの差分はない。
失敗したPR auditのJSON、URL、時系列、約103 MiBの完全traceを保持する。
チャット提出用には完全traceを復元可能な4個の30MB未満ZIPに分割し、SHA256を付す。

この画像監査NGが残るため、実装はDraft PRで提出し、受入済みとは扱わない。
CIが後で成功しても、今回の失敗記録と原因の確認は別途必要である。

### PMへ残す確認

物理端末、Safari/WebKit、ブラウザchrome/OS文字設定・全pinch/zoom条件の直積は未確認。
PNG/フォントの環境差はstrictな期待矩形で失敗として見えるため、無条件の基準更新で吸収しない。
PR #76の`bowfin.png net::ERR_ABORTED`は根因未確定の既知リスクとして保持する。
画像監査のassertion/失敗分類は変更していない。最終画像監査の結果は上表/PRへ記録する。
初回L2の全件CIを前提とし、PR提出後はPMがCI監査・マージ・デプロイ・実機受入を担当する。
CodexはCI待機・監視・rerun・マージ・デプロイを行わない。
