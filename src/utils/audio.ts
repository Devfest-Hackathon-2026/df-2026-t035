/**
 * Utility for audio level monitoring via Web Audio API (VU meter)
 */
export class MicAudioMonitor {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private animFrameId: number | null = null;
  private onLevelCallback: (level: number) => void;

  constructor(onLevel: (level: number) => void) {
    this.onLevelCallback = onLevel;
  }

  public async start(stream: MediaStream) {
    this.stop();

    try {
      const AudioCtxClass =
        window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();

      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.5;

      this.microphone = this.audioCtx.createMediaStreamSource(stream);
      this.microphone.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        if (!this.analyser) return;

        this.analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        // Normalize 0 to 100 with non-linear boost for quiet speech
        const normalized = Math.min(100, Math.round((average / 128) * 100));

        this.onLevelCallback(normalized);

        this.animFrameId = requestAnimationFrame(checkVolume);
      };

      checkVolume();
    } catch (e) {
      console.error('Failed to initialize MicAudioMonitor:', e);
    }
  }

  public stop() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.microphone) {
      try {
        this.microphone.disconnect();
      } catch {}
      this.microphone = null;
    }
    if (this.analyser) {
      this.analyser = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try {
        this.audioCtx.close();
      } catch {}
      this.audioCtx = null;
    }
    this.onLevelCallback(0);
  }
}
