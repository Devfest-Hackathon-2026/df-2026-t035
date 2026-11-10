// Procedural Web Audio API Sound Effects (Zero external file dependencies)

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx) {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (AudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
  }
  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

let lastApplauseTime = 0;

/**
 * Synthesizes realistic, full-bodied multi-person room applause using overlapping
 * bandpass/highpass-filtered clap bursts routed through a dynamics compressor
 * so volume matches spoken TTS voice levels.
 */
export function playApplauseSound(
  audienceCount = 6,
  durationMs = 3200
): void {
  const nowMs = Date.now();
  if (nowMs - lastApplauseTime < 8000) return; // Prevent duplicate or back-to-back applause triggers
  lastApplauseTime = nowMs;

  const ctx = getAudioContext();
  if (!ctx) return;

  const clampedPeople = Math.max(1, Math.min(100, audienceCount));
  // Number of individual clap impulses scales from 1 person up to a 100-person hall
  const clapDensityPerSec = Math.min(
    140,
    14 + Math.sqrt(clampedPeople) * 13.5
  );
  const totalClaps = Math.floor((durationMs / 1000) * clapDensityPerSec);

  // Create a reusable 0.13s crisp clap impulse buffer
  const sampleRate = ctx.sampleRate;
  const bufferLength = Math.floor(sampleRate * 0.13);
  const noiseBuffer = ctx.createBuffer(1, bufferLength, sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferLength; i++) {
    const t = i / bufferLength;
    // Sharp initial transient + natural palm decay
    const transient = t < 0.06 ? 1.35 : 1.0;
    const env = Math.pow(1 - t, 2.1) * transient;
    data[i] = (Math.random() * 2 - 1) * env;
  }

  const startTime = ctx.currentTime + 0.01;

  // Dynamics compressor keeps loud applause punchy and on par with TTS speech without clipping
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-14, startTime);
  compressor.knee.setValueAtTime(12, startTime);
  compressor.ratio.setValueAtTime(4, startTime);
  compressor.attack.setValueAtTime(0.003, startTime);
  compressor.release.setValueAtTime(0.15, startTime);

  const masterGain = ctx.createGain();
  // Scale master volume so applause is clearly audible alongside avatar speech
  const hallGain = Math.min(1.15, 0.72 + Math.log10(clampedPeople + 1) * 0.24);
  masterGain.gain.setValueAtTime(hallGain, startTime);

  masterGain.connect(compressor);
  compressor.connect(ctx.destination);

  for (let i = 0; i < totalClaps; i++) {
    const progress = i / totalClaps;
    const macroEnv =
      progress < 0.1
        ? progress / 0.1
        : progress > 0.72
        ? Math.max(0.06, 1 - (progress - 0.72) / 0.28)
        : 1.0;

    const jitter = (Math.random() - 0.5) * 0.055;
    const clapTime = Math.max(
      startTime,
      startTime + (progress * durationMs) / 1000 + jitter
    );

    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;

    // Bandpass filter simulating hollow cupped-palm resonance (850Hz - 2600Hz)
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(880 + Math.random() * 1650, clapTime);
    filter.Q.setValueAtTime(1.4 + Math.random() * 1.9, clapTime);

    const gain = ctx.createGain();
    const peak = (0.24 + Math.random() * 0.28) * macroEnv;
    gain.gain.setValueAtTime(0.001, clapTime);
    gain.gain.linearRampToValueAtTime(peak, clapTime + 0.003);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      clapTime + 0.075 + Math.random() * 0.04
    );

    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime((Math.random() - 0.5) * 1.5, clapTime);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(panner);
      panner.connect(masterGain);
    } else {
      source.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);
    }

    source.start(clapTime);
    source.stop(clapTime + 0.12);
  }
}

export interface SneezeSpatialOptions {
  rowIndex?: number; // 0 = front row (loudest), 1 = 2nd row, 2+ = back rows (progressively quieter)
  totalRows?: number;
  panX?: number; // -1.0 (left) to +1.0 (right)
}

/**
 * Synthesizes a clear, realistic audience sneeze ("ハクション！" / "クシュン！") or throat clear ("ゴホン")
 * with spatial row-distance volume attenuation and stereo panning.
 * Front row (rowIndex = 0) is loud and close; back rows are progressively quieter and slightly muffled.
 */
export function playSneezeOrCoughSound(
  type: 'sneeze' | 'cough' = 'sneeze',
  gender: 'male' | 'female' = 'male',
  spatial: SneezeSpatialOptions = {}
): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const rowIndex = Math.max(0, spatial.rowIndex ?? 0);
  const panValue = Math.max(-0.9, Math.min(0.9, spatial.panX ?? 0));

  // Distance attenuation by row:
  // Row 0 (front row): 1.0x (loud, right in front of presenter)
  // Row 1 (2nd row): 0.62x
  // Row 2 (3rd row): 0.40x
  // Row 3+ (further back in lecture hall): progressively softer down to 0.16x
  const distanceGain =
    rowIndex === 0
      ? 1.0
      : rowIndex === 1
      ? 0.62
      : Math.max(0.16, Math.pow(0.64, rowIndex));

  // Air/room lowpass cutoff for back rows so distant sneezes sound naturally farther away
  const distanceCutoffHz =
    rowIndex === 0
      ? 7500
      : rowIndex === 1
      ? 5200
      : Math.max(2200, 4800 - rowIndex * 450);

  const t0 = ctx.currentTime + 0.02;

  // Master spatial output chain (Distance Lowpass -> Stereo Panner -> Compressor -> Destination)
  const roomFilter = ctx.createBiquadFilter();
  roomFilter.type = 'lowpass';
  roomFilter.frequency.setValueAtTime(distanceCutoffHz, t0);

  const masterOut = ctx.createGain();
  masterOut.gain.setValueAtTime(distanceGain, t0);

  roomFilter.connect(masterOut);

  if (ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(panValue, t0);
    masterOut.connect(panner);
    panner.connect(ctx.destination);
  } else {
    masterOut.connect(ctx.destination);
  }

  // Create noise buffer for fricative burst
  const sampleRate = ctx.sampleRate;
  const len = Math.floor(sampleRate * 0.5);
  const noiseBuf = ctx.createBuffer(1, len, sampleRate);
  const ch = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    ch[i] = Math.random() * 2 - 1;
  }

  if (type === 'sneeze') {
    const baseFreq = gender === 'female' ? 265 : 155;

    // Part 1: Voiced inhalation / pre-sneeze ("ハッ...")
    const intakeOsc = ctx.createOscillator();
    const intakeGain = ctx.createGain();
    intakeOsc.type = 'sawtooth';
    intakeOsc.frequency.setValueAtTime(baseFreq, t0);
    intakeOsc.frequency.linearRampToValueAtTime(baseFreq * 1.48, t0 + 0.1);

    const intakeFilter = ctx.createBiquadFilter();
    intakeFilter.type = 'bandpass';
    intakeFilter.frequency.setValueAtTime(gender === 'female' ? 1150 : 880, t0);
    intakeFilter.Q.setValueAtTime(2.0, t0);

    intakeGain.gain.setValueAtTime(0.001, t0);
    intakeGain.gain.linearRampToValueAtTime(0.32, t0 + 0.03);
    intakeGain.gain.exponentialRampToValueAtTime(0.002, t0 + 0.11);

    intakeOsc.connect(intakeFilter);
    intakeFilter.connect(intakeGain);
    intakeGain.connect(roomFilter);
    intakeOsc.start(t0);
    intakeOsc.stop(t0 + 0.12);

    // Part 2: Vocalized sneeze formant ("クシュン！") + sharp air burst at t0 + 0.13s
    const burstTime = t0 + 0.13;

    const voiceOsc = ctx.createOscillator();
    const voiceGain = ctx.createGain();
    voiceOsc.type = 'triangle';
    voiceOsc.frequency.setValueAtTime(baseFreq * 1.65, burstTime);
    voiceOsc.frequency.exponentialRampToValueAtTime(
      baseFreq * 0.85,
      burstTime + 0.22
    );

    voiceGain.gain.setValueAtTime(0.001, burstTime);
    voiceGain.gain.linearRampToValueAtTime(0.45, burstTime + 0.015);
    voiceGain.gain.exponentialRampToValueAtTime(0.002, burstTime + 0.24);

    voiceOsc.connect(voiceGain);
    voiceGain.connect(roomFilter);
    voiceOsc.start(burstTime);
    voiceOsc.stop(burstTime + 0.25);

    // High-energy fricative sneeze noise burst ("シュン！")
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(
      gender === 'female' ? 2700 : 2050,
      burstTime
    );
    bandpass.frequency.exponentialRampToValueAtTime(1050, burstTime + 0.26);
    bandpass.Q.setValueAtTime(1.6, burstTime);

    const burstGain = ctx.createGain();
    burstGain.gain.setValueAtTime(0.001, burstTime);
    burstGain.gain.linearRampToValueAtTime(0.82, burstTime + 0.012);
    burstGain.gain.exponentialRampToValueAtTime(0.002, burstTime + 0.29);

    noiseSrc.connect(bandpass);
    bandpass.connect(burstGain);
    burstGain.connect(roomFilter);
    noiseSrc.start(burstTime);
    noiseSrc.stop(burstTime + 0.31);
  } else {
    // Realistic double throat-clear ("ゴホン、ゴホン")
    [0, 0.17].forEach((offset, idx) => {
      const start = t0 + offset;
      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuf;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(
        (gender === 'female' ? 1150 : 780) * (idx === 0 ? 1.06 : 0.92),
        start
      );
      filter.Q.setValueAtTime(2.6, start);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.46, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.002, start + 0.13);

      noiseSrc.connect(filter);
      filter.connect(gain);
      gain.connect(roomFilter);
      noiseSrc.start(start);
      noiseSrc.stop(start + 0.14);
    });
  }
}
