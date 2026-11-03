// This timer belongs to the presentation, independently of the game clock.
// Constructing the title does not start it or delay initialization/input.
export function createOpeningTitle(element = document.querySelector('#opening-title')) {
  const error = document.querySelector('#error');
  let started = false, timer;
  const errorObserver = new MutationObserver(() => {
    if (!error.hidden) hide();
  });
  function hide() {
    started = true;
    clearTimeout(timer);
    timer = undefined;
    element.hidden = true;
    errorObserver.disconnect();
  }
  return {
    start() {
      if (started) return;
      if (!error.hidden) { hide(); return; }
      started = true;
      errorObserver.observe(error, { attributes: true, attributeFilter: ['hidden'] });
      element.hidden = false;
      timer = setTimeout(hide, 3000);
    },
  };
}
