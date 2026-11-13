export function renderPlaySettings(content, preferences) {
  const section = document.createElement('section'); section.className = 'play-settings';
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.id = 'day-night-skip-toggle';
  const update = state => {
    toggle.textContent = `昼夜スキップ：${state.dayNightSkip ? 'オン' : 'オフ'}`;
    toggle.setAttribute('aria-pressed', String(state.dayNightSkip));
  };
  toggle.addEventListener('click', () => preferences.setDayNightSkip(!preferences.state.dayNightSkip));
  section.append(toggle); content.append(section); update(preferences.state);
  return preferences.subscribe(update);
}
