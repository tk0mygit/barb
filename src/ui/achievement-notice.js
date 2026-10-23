// Presentation only. The manager commits every award before this queue sees it.
// A single live region moves into the active modal so it stays visible and
// accessible there; its timer is independent of the paused game clock.
export function createAchievementNotice() {
  const notice = document.querySelector('#achievement-notice');
  const app = document.querySelector('#app');
  const collectionDialog = document.querySelector('#collection-dialog');
  const catchDialog = document.querySelector('#catch-dialog');
  const queue = [], seen = new Set();
  const duration = 3500;
  let expiresAt = 0, timeout = null;
  function syncHost() {
    const host = collectionDialog.open ? collectionDialog : catchDialog.open ? catchDialog : app;
    if (notice.parentElement === host) return;
    if (host === collectionDialog) host.insertBefore(notice, document.querySelector('#collection-content'));
    else host.prepend(notice);
  }
  function update() {
    clearTimeout(timeout); timeout = null;
    syncHost();
    const now = Date.now();
    if (expiresAt && now >= expiresAt) { queue.shift(); expiresAt = 0; }
    // An already displayed award expires in the background. Pending awards
    // retain their full turn, and start only when the document is visible.
    if (!expiresAt && queue.length && !document.hidden) expiresAt = now + duration;
    notice.hidden = !expiresAt || document.hidden;
    const current = expiresAt ? queue[0] : null;
    if (notice.dataset.achievementId !== current?.id) {
      notice.replaceChildren();
      if (current) {
        const label = document.createElement('span'); label.textContent = '実績解除';
        const name = document.createElement('strong'); name.textContent = current.name;
        notice.append(label, name); notice.dataset.achievementId = current.id;
      } else delete notice.dataset.achievementId;
    }
    if (expiresAt) timeout = setTimeout(update, Math.max(0, expiresAt - now));
  }
  for (const dialog of [collectionDialog, catchDialog]) {
    dialog.addEventListener('toggle', update); dialog.addEventListener('close', update);
  }
  document.addEventListener('visibilitychange', update);
  for (const event of ['focus', 'pageshow']) window.addEventListener(event, update);
  return {
    update,
    notify(awards) {
      update();
      for (const { id, name } of awards) {
        if (seen.has(id)) continue;
        seen.add(id); queue.push({ id, name });
      }
      update();
    },
  };
}
