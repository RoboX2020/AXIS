/**
 * Avionics Audio Synthesizer (Web Audio API)
 * Generates synthetic TCAS tones, clackers, and warning chimes
 */

class AvionicsAudio {
  private ctx: AudioContext | null = null;
  public isMuted: boolean = false;

  private initContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public playTone(freq: number, type: OscillatorType, durationMs: number, gainValue: number = 0.15) {
    if (this.isMuted) return;
    try {
      this.initContext();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      gain.gain.setValueAtTime(gainValue, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + durationMs / 1000);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + durationMs / 1000);
    } catch {
      // Audio autoplay policies or unsupported browser
    }
  }

  // TCAS Traffic Advisory chime (Double tone chime: 880Hz -> 660Hz)
  public playTrafficAdvisory() {
    if (this.isMuted) return;
    this.playTone(880, 'sine', 160, 0.2);
    setTimeout(() => {
      this.playTone(660, 'sine', 200, 0.2);
    }, 180);
  }

  // TCAS Resolution Advisory siren (Urgent dual-warble)
  public playResolutionAdvisory() {
    if (this.isMuted) return;
    this.playTone(1040, 'sawtooth', 140, 0.22);
    setTimeout(() => {
      this.playTone(800, 'sawtooth', 140, 0.22);
    }, 150);
    setTimeout(() => {
      this.playTone(1040, 'sawtooth', 140, 0.22);
    }, 300);
  }

  // Conflict resolved chime (pleasant ascending notification)
  public playClearOfConflict() {
    if (this.isMuted) return;
    this.playTone(523.25, 'sine', 150, 0.15); // C5
    setTimeout(() => {
      this.playTone(659.25, 'sine', 150, 0.15); // E5
    }, 120);
    setTimeout(() => {
      this.playTone(783.99, 'sine', 280, 0.15); // G5
    }, 240);
  }
}

export const avionicsAudio = new AvionicsAudio();
