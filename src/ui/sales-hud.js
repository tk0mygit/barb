import { pickBuyerLine } from '../game/buyer-lines.js';

export function formatMoney(amount) { return `${amount.toLocaleString('ja-JP')} 通貨`; }

export function createSalesHUD(collection) {
  const balance = document.querySelector('#wallet-balance');
  const menuBalance = document.querySelector('#collection-wallet');
  const notice = document.querySelector('#sale-notice');
  const menuNotice = document.querySelector('#collection-sale-notice');
  function update() {
    balance.textContent = formatMoney(collection.wallet.balance);
    menuBalance.textContent = `所持金 ${formatMoney(collection.wallet.balance)}`;
  }
  update();
  return {
    update,
    hideNotice() { notice.hidden = true; },
    notify(receipt) {
      if (!receipt) return;
      const message = `${receipt.count}匹を売却 · +${formatMoney(receipt.total)}\n買取人「${pickBuyerLine()}」`;
      for (const target of [notice, menuNotice]) { target.textContent = message; target.hidden = false; }
      update(); // Menu pauses the frame loop; update balances synchronously.
    },
  };
}
