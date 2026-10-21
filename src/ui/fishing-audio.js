// Generated placeholder sound; audio failure must never block fishing.
export function createFishingAudio() {
  let context;
  return {
    unlock() {
      try {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        context ??= new Audio();
        if (context.state === 'suspended') context.resume().catch(() => {});
      } catch { /* Visual notification remains available. */ }
    },
    bite() {
      if (!context || context.state !== 'running') return;
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      oscillator.frequency.linearRampToValueAtTime(1320, context.currentTime + 0.16);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.3);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + 0.32);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    },
  };
}
