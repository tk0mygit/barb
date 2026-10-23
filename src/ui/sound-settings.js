const MODE_NAMES = { DAY: '昼のBGM', NIGHT_CLEAR: '夜のBGM', NIGHT_FOG: '霧夜の自然音' };
const PLAYBACK_NAMES = {
  off: 'OFF', waiting: '操作後に再生できます', paused: '一時停止中（メニューなど）',
  playing: '再生中', muted: '音量0%（無音）', blocked: '開始できませんでした。再試行できます',
  interrupted: '音声が中断されました。再試行できます', unsupported: 'このブラウザは音声に対応していません',
};
const SAVE_NAMES = {
  default: '初期設定です。変更時にこのブラウザへ保存します。', loaded: '音声設定を読み込みました。',
  invalid: '音声設定が不正なため、初期設定（OFF）を使用します。', unavailable: '音声設定を読み込めません。変更は今回のみになる場合があります。',
  saved: '音声設定を保存しました。', failed: '音声設定を保存できませんでした。今回の設定は有効です。',
};
function node(tag, text) { const value = document.createElement(tag); if (text) value.textContent = text; return value; }

// Render once per visit; status updates never replace focused controls.
export function renderSoundSettings(content, audio) {
  const section = node('section'); section.className = 'sound-settings';
  const description = node('p', 'BGM・自然音の設定です。アタリ通知音はこの設定に含まれません。メニューを閉じると現在の時間帯で再開します。');
  const toggle = node('button'); toggle.id = 'ambient-toggle'; toggle.type = 'button';
  toggle.addEventListener('click', () => {
    audio.setPreferences({ enabled: !audio.state.preferences.enabled });
    if (audio.state.preferences.enabled) audio.unlock();
  });
  const label = node('label', 'BGM・自然音の音量'); label.htmlFor = 'ambient-volume';
  const volume = node('input'); volume.type = 'range'; volume.min = '0'; volume.max = '100'; volume.step = '1'; volume.id = 'ambient-volume';
  const output = node('output'); output.htmlFor = volume.id;
  volume.addEventListener('input', () => audio.setPreferences({ volume: Number(volume.value) }));
  const status = node('p'); status.id = 'ambient-status'; status.setAttribute('role', 'status');
  const mode = node('p'); mode.id = 'ambient-mode';
  const saved = node('p'); saved.id = 'audio-preferences-status'; saved.setAttribute('role', 'status');
  const retry = node('button', '音声の開始を再試行'); retry.type = 'button'; retry.id = 'ambient-retry';
  retry.addEventListener('click', () => audio.unlock());
  const update = ({ preferences, persistence, playback, mode: currentMode }) => {
    toggle.textContent = `BGM・自然音：${preferences.enabled ? 'ON' : 'OFF'}`;
    toggle.setAttribute('aria-pressed', String(preferences.enabled));
    volume.value = String(preferences.volume); volume.setAttribute('aria-valuetext', `${preferences.volume}%`);
    output.value = `${preferences.volume}%`;
    status.textContent = PLAYBACK_NAMES[playback]; mode.textContent = `現在の環境：${MODE_NAMES[currentMode]}`;
    saved.textContent = SAVE_NAMES[persistence];
    retry.hidden = !preferences.enabled || !['waiting', 'blocked', 'interrupted'].includes(playback);
  };
  section.append(description, toggle, label, volume, output, status, mode, retry, saved); content.append(section);
  update(audio.state);
  return audio.subscribe(update);
}
