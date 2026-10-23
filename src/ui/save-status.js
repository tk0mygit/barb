// Presentation only: neither a pending request nor a failed write is success.
export function createSaveStatus() {
  const compact = document.querySelector('#save-status');
  const details = [document.querySelector('#collection-save-status'), document.querySelector('#catch-save-status')];
  const times = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return {
    update(status) {
      const { phase, code, savedAt, restoredFromBackup } = status;
      let label, explanation;
      switch (phase) {
        case 'saved': case 'restored': case 'backup':
          label = '保存済み'; explanation = 'このブラウザに保存済みです。'; break;
        case 'dirty':
          label = '未保存の変更あり'; explanation = '未保存の変更があります。自動保存を待っています。'; break;
        case 'failed':
          label = '保存失敗・進行は未保存';
          explanation = code === 'quota-exceeded'
            ? '保存容量が不足しています。今回の進行は保存できていません。以前の保存は保持し、再試行します。'
            : '保存に失敗しました。今回の進行は保存できていません。以前の保存は保持し、再試行します。'; break;
        case 'unavailable':
          label = '保存不可・進行は未保存';
          explanation = status.canSave
            ? '現在は保存機能を利用できません。今回の進行は未保存です。以前の保存を保持し、再試行します。'
            : '保存機能を利用できません。今回の進行は保存されません。ブラウザの保存許可を確認して再読み込みしてください。'; break;
        case 'protected':
          label = '破損・未対応／保存停止';
          explanation = code === 'generation-exhausted'
            ? '保存世代の上限に達したため保存を停止しています。以後の進行は保存されません。既存の記録は保持しています。'
            : '保存データが破損、未対応、または安全に復元できないため保護しています。今回の進行は保存されません。'; break;
        case 'conflict':
          label = '他タブと競合・保存停止'; explanation = '他のタブから保存が変更されました。上書きを防ぐため自動保存を停止しています。このタブの進行は未保存です。タブを閉じて再読み込みしてください。'; break;
        default:
          label = '初回の保存待ち'; explanation = '保存はまだありません。進行後に自動保存します。';
      }
      if (restoredFromBackup) {
        label = phase === 'backup' || phase === 'restored' || phase === 'saved' ? 'バックアップから復元' : `${label}（バックアップ復元）`;
        explanation = `バックアップの古い記録から復元しました。${explanation}`;
      }
      if (savedAt) explanation += ` 最終保存 ${times.format(new Date(savedAt))}`;
      compact.dataset.phase = phase;
      compact.textContent = label;
      compact.title = explanation;
      for (const target of details) { target.dataset.phase = phase; target.textContent = explanation; }
    },
  };
}
