import { createAudioSession } from '../audio/audio-session.js';

// The original 880→1320 Hz notification keeps its timing/envelope. Ambient
// settings only control a separate gain path on the shared context.
export function createFishingAudio({ session = createAudioSession() } = {}) {
  return {
    unlock: () => session.unlock(),
    bite() {
      const context = session.context;
      if (!context || context.state !== 'running') return;
      let oscillator, gain;
      const release = () => { oscillator?.disconnect(); gain?.disconnect(); };
      try {
        oscillator = context.createOscillator(); gain = context.createGain();
        oscillator.frequency.setValueAtTime(880, context.currentTime);
        oscillator.frequency.linearRampToValueAtTime(1320, context.currentTime + 0.16);
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.3);
        oscillator.connect(gain).connect(context.destination);
        oscillator.onended = release;
        oscillator.start(); oscillator.stop(context.currentTime + 0.32);
      } catch {
        try { oscillator?.stop(); } catch { /* May not have started. */ }
        release(); // Audio failure must never block the hook input window.
      }
    },
  };
}
