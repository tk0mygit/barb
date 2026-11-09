// Passive visual definitions only. Class names come from the owning UI;
// positioning, visibility and all QTE input/time remain with that UI.
export const QTE_LABELS = Object.freeze({
  flick: '短く素早くフリック', swipe: '長くスワイプ', tap: '3回タップ', target: 'ターゲットを選択',
});

export function qteArrowMarkup({ className = 'qte-arrow-shape', secondaryClassName = 'qte-arrow-secondary' } = {}) {
  // One filled shape for every direction; owners rotate it without stretching.
  const shape = classes => `<svg class="${classes}" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path d="M12 36H53V18L86 50 53 82V64H12Z"/></svg>`;
  return shape(className) + shape(`${className} ${secondaryClassName}`);
}

export function qteTargetMarkup(className = 'qte-target') {
  return `<span class="${className}"></span>`;
}

export function qteTapProgress(completed = 0) {
  return `${completed}/3 ${'●'.repeat(completed)}${'○'.repeat(3 - completed)}`;
}
