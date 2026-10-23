import { pickBuyerLine } from '../game/buyer-lines.js';

export function formatMoney(amount) { return `${amount.toLocaleString('ja-JP')} 通貨`; }

export function createSalesHUD(collection) {
  const balance = document.querySelector('#wallet-balance');
  const menuBalance = document.querySelector('#collection-wallet');
  const notice = document.querySelector('#sale-notice');
  const menuNotice = document.querySelector('#collection-sale-notice');
  let timeout = null, expiresAt = 0, generation = 0;
  function hideNotice() {
    clearTimeout(timeout); timeout = null; expiresAt = 0; generation++;
    for (const target of [notice, menuNotice]) { target.hidden = true; target.textContent = ''; }
  }
  function expireNotice() {
    if (expiresAt && Date.now() >= expiresAt) hideNotice();
  }
  // Timers can be throttled in the background. Recheck the wall-clock deadline
  // on restoration and on menu/HUD updates, independently of animation frames.
  document.addEventListener('visibilitychange', expireNotice);
  window.addEventListener('focus', expireNotice);
  window.addEventListener('pageshow', expireNotice);
  function update() {
    expireNotice();
    balance.textContent = formatMoney(collection.wallet.balance);
    menuBalance.textContent = `所持金 ${formatMoney(collection.wallet.balance)}`;
  }
  update();
  return {
    update,
    hideNotice,
    notify(receipt) {
      if (!receipt) return;
      hideNotice();
      expiresAt = Date.now() + 5000;
      const currentGeneration = generation;
      function expire() {
        if (generation !== currentGeneration) return;
        expireNotice();
        if (expiresAt) timeout = setTimeout(expire, Math.max(0, expiresAt - Date.now()));
      }
      timeout = setTimeout(expire, 5000);
      const message = `${receipt.count}匹を売却 · +${formatMoney(receipt.total)}\n買取人「${pickBuyerLine()}」`;
      for (const target of [notice, menuNotice]) { target.textContent = message; target.hidden = false; }
      update(); // Menu pauses the frame loop; update balances synchronously.
    },
  };
}
