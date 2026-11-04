// Presentation only. The manager commits every award before this queue sees it.
// A single live region moves into the active modal so it stays visible and
// accessible there; its timer is independent of the paused game clock.
export function createAchievementNotice() {
  const notice = document.querySelector('#achievement-notice');
  const app = document.querySelector('#app');
  const collectionDialog = document.querySelector('#collection-dialog');
  const catchDialog = document.querySelector('#catch-dialog');
  const queue = [], seen = new Set();
  const duration = 5000;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let expiresAt = 0, timeout = null, animation = null;
  function syncHost(event) {
    // beforetoggle fires before the native open attribute changes. Move the
    // notice in that same turn so the first visible layout is already final;
    // moving it on the later toggle task can move a button under a pending tap.
    const changing = event?.type === 'beforetoggle' ? event : null;
    const isOpen = dialog => changing?.target === dialog ? changing.newState === 'open' : dialog.open;
    const host = isOpen(collectionDialog) ? collectionDialog : isOpen(catchDialog) ? catchDialog : app;
    if (notice.parentElement === host) return false;
    // Keep the same live region and text nodes. State-preserving moves avoid
    // reconnecting the accessible subtree where supported; append is a fallback.
    if (host.moveBefore) host.moveBefore(notice, null);
    else host.append(notice);
    return true;
  }
  function update(event) {
    clearTimeout(timeout); timeout = null;
    const moved = syncHost(event);
    const now = Date.now();
    if (expiresAt && now >= expiresAt) { queue.shift(); expiresAt = 0; }
    // An already displayed award expires in the background. Pending awards
    // retain their full turn, and start only when the document is visible.
    if (!expiresAt && queue.length && !document.hidden) expiresAt = now + duration;
    notice.hidden = !expiresAt || document.hidden;
    const current = expiresAt ? queue[0] : null;
    if (notice.dataset.achievementId !== current?.id) {
      animation?.cancel(); animation = null;
      notice.replaceChildren();
      if (current) {
        const label = document.createElement('span'); label.textContent = '実績を解除した';
        const name = document.createElement('strong'); name.textContent = current.name;
        notice.append(label, name); notice.dataset.achievementId = current.id;
      } else delete notice.dataset.achievementId;
    }
    if (notice.hidden || reducedMotion.matches) {
      animation?.cancel(); animation = null;
    } else if (!animation) {
      // Only opacity changes. Each award gets a fresh effect; dialog moves and
      // visibility restoration resume at its original real-time age.
      animation = notice.animate([
        { opacity: 0, offset: 0 }, { opacity: 1, offset: 0.12 },
        { opacity: 1, offset: 0.88 }, { opacity: 0, offset: 1 },
      ], { duration, easing: 'linear', fill: 'both' });
      animation.currentTime = duration - (expiresAt - now);
    } else if (moved) animation.currentTime = duration - (expiresAt - now);
    if (expiresAt) timeout = setTimeout(update, Math.max(0, expiresAt - now));
  }
  for (const dialog of [collectionDialog, catchDialog]) {
    dialog.addEventListener('beforetoggle', update);
    dialog.addEventListener('toggle', update); dialog.addEventListener('close', update);
  }
  document.addEventListener('visibilitychange', update);
  reducedMotion.addEventListener('change', update);
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
