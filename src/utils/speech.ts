import {
  RoleType,
  GeminiVoiceName,
  VoiceEngineMode,
  AudienceMember,
} from '../types/presentation';

export interface GeminiVoiceOption {
  id: GeminiVoiceName;
  label: string;
  gender: 'male' | 'female';
  description: string;
}

export const GEMINI_VOICE_OPTIONS: GeminiVoiceOption[] = [
  {
    id: 'Charon',
    label: 'Neural2-D (重厚・ピッチ-3.0)',
    gender: 'male',
    description: 'Neural2-D + ピッチ低調（教授・主査向け威厳ボイス）',
  },
  {
    id: 'Fenrir',
    label: 'Neural2-C (標準・ピッチ-1.2)',
    gender: 'male',
    description: 'Neural2-C + 落ち着き（同輩・先輩向け知性ボイス）',
  },
  {
    id: 'Puck',
    label: 'Neural2-C (高め・ピッチ+2.2)',
    gender: 'male',
    description: 'Neural2-C + ピッチ高調（後輩向けハキハキボイス）',
  },
  {
    id: 'Kore',
    label: 'Neural2-B (落ち着き・ピッチ-1.8)',
    gender: 'female',
    description: 'Neural2-B + ピッチ微低（教授・同輩向け理知ボイス）',
  },
  {
    id: 'Zephyr',
    label: 'Neural2-B (明るめ・ピッチ+1.8)',
    gender: 'female',
    description: 'Neural2-B + ピッチ微高（同輩・後輩向け親しみボイス）',
  },
];

export function getDefaultGeminiVoice(
  role: RoleType,
  gender: 'male' | 'female',
  seatIndex = 0
): GeminiVoiceName {
  if (gender === 'female') {
    if (role === 'professor') return 'Kore';
    if (role === 'junior') return 'Zephyr';
    return seatIndex % 2 === 0 ? 'Kore' : 'Zephyr';
  } else {
    if (role === 'professor') return seatIndex === 0 ? 'Charon' : 'Fenrir';
    if (role === 'junior') return 'Puck';
    return seatIndex % 2 === 0 ? 'Fenrir' : 'Puck';
  }
}

// Voice settings per role for Web Speech API fallback / browser mode
export interface VoicePersona {
  pitch: number;
  rate: number;
  genderHint?: 'male' | 'female';
}

export function getPersonaSettings(
  role: RoleType,
  gender: 'male' | 'female' = 'male',
  voiceName?: GeminiVoiceName
): VoicePersona {
  if (voiceName === 'Charon') {
    return { pitch: 0.76, rate: 1.14, genderHint: 'male' };
  }
  if (voiceName === 'Fenrir') {
    return { pitch: 0.88, rate: 1.2, genderHint: 'male' };
  }
  if (voiceName === 'Puck') {
    return { pitch: 1.08, rate: 1.28, genderHint: 'male' };
  }
  if (voiceName === 'Kore') {
    return { pitch: 1.12, rate: 1.18, genderHint: 'female' };
  }
  if (voiceName === 'Zephyr') {
    return { pitch: 1.28, rate: 1.26, genderHint: 'female' };
  }

  switch (role) {
    case 'professor':
      return {
        pitch: gender === 'male' ? 0.8 : 0.95,
        rate: 1.14,
        genderHint: gender,
      };
    case 'junior':
      return {
        pitch: gender === 'female' ? 1.3 : 1.12,
        rate: 1.28,
        genderHint: gender,
      };
    case 'peer':
    default:
      return {
        pitch: gender === 'female' ? 1.15 : 0.94,
        rate: 1.2,
        genderHint: gender,
      };
  }
}

// Global voice engine mode ('gemini' vs 'browser')
let globalVoiceEngineMode: VoiceEngineMode = 'gemini';

export function setGlobalVoiceEngineMode(mode: VoiceEngineMode): void {
  globalVoiceEngineMode = mode;
}

export function getGlobalVoiceEngineMode(): VoiceEngineMode {
  return globalVoiceEngineMode;
}

// L1 Client-side audio cache + metadata + in-flight request deduplication map
const clientTtsAudioCache = new Map<string, string>();
const clientTtsMetaCache = new Map<
  string,
  { mimeType: string; isNeuralFallback: boolean }
>();
const inFlightTtsPromises = new Map<string, Promise<string | null>>();

function getNeuralFallbackPlaybackRate(voiceName: GeminiVoiceName): number {
  switch (voiceName) {
    case 'Charon':
      return 1.06; // Deep, authoritative professor voice (faster tempo)
    case 'Fenrir':
      return 1.12; // Calm adult male voice (faster tempo)
    case 'Puck':
      return 1.24; // Energetic junior male voice
    case 'Kore':
      return 1.18; // Articulate intellectual female voice
    case 'Zephyr':
    default:
      return 1.26; // Bright, cheerful female voice
  }
}

// Global set to retain active utterances, Web Audio nodes, and HTMLAudioElement fallback
const activeUtterances = new Set<SpeechSynthesisUtterance>();
let activeHtmlAudio: HTMLAudioElement | null = null;
let activeAudioBufferSource: AudioBufferSourceNode | null = null;
let activeSpeechAbortController: AbortController | null = null;

// Persistent Web Audio API context for 100% reliable, autoplay-safe Gemini TTS WAV playback
let sharedTtsAudioContext: AudioContext | null = null;

function getOrCreateTtsAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedTtsAudioContext) {
    const AudioCtx =
      window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      try {
        sharedTtsAudioContext = new AudioCtx();
      } catch {
        sharedTtsAudioContext = null;
      }
    }
  }
  if (sharedTtsAudioContext && sharedTtsAudioContext.state === 'suspended') {
    sharedTtsAudioContext.resume().catch(() => {});
  }
  return sharedTtsAudioContext;
}

// Automatically unlock sharedTtsAudioContext on any user gesture in the browser
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    const ctx = getOrCreateTtsAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  };
  window.addEventListener('pointerdown', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });
  window.addEventListener('touchstart', unlockAudio, { passive: true });
}

/**
 * Decodes a base64 audio buffer (RIFF WAV 24kHz 16-bit mono PCM or MPEG audio) into a Web Audio AudioBuffer.
 * Uses fast synchronous PCM parsing for standard 16-bit WAVs and falls back to ctx.decodeAudioData for MPEG/other formats.
 */
async function decodeWavBase64ToAudioBuffer(
  ctx: AudioContext,
  base64Data: string
): Promise<AudioBuffer> {
  const binaryStr = window.atob(base64Data);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  // Fast synchronous parser for standard 16-bit PCM RIFF WAV
  if (
    len > 44 &&
    bytes[0] === 0x52 && // 'R'
    bytes[1] === 0x49 && // 'I'
    bytes[2] === 0x46 && // 'F'
    bytes[3] === 0x46 && // 'F'
    bytes[8] === 0x57 && // 'W'
    bytes[9] === 0x41 && // 'A'
    bytes[10] === 0x56 && // 'V'
    bytes[11] === 0x45 // 'E'
  ) {
    try {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let offset = 12;
      let audioFormat = 1;
      let numChannels = 1;
      let sampleRate = 24000;
      let bitsPerSample = 16;
      let dataOffset = -1;
      let dataLength = 0;

      while (offset + 8 <= len) {
        const chunkId = String.fromCharCode(
          bytes[offset],
          bytes[offset + 1],
          bytes[offset + 2],
          bytes[offset + 3]
        );
        const chunkSize = view.getUint32(offset + 4, true);
        if (chunkId === 'fmt ' && offset + 24 <= len) {
          audioFormat = view.getUint16(offset + 8, true);
          numChannels = Math.max(1, view.getUint16(offset + 10, true));
          sampleRate = Math.max(8000, view.getUint32(offset + 12, true));
          bitsPerSample = view.getUint16(offset + 22, true);
        } else if (chunkId === 'data') {
          dataOffset = offset + 8;
          dataLength = Math.min(chunkSize, len - dataOffset);
          break;
        }
        offset += 8 + chunkSize + (chunkSize % 2);
      }

      if (audioFormat === 1 && bitsPerSample === 16 && dataOffset > 0 && dataLength > 0) {
        const bytesPerFrame = 2 * numChannels;
        const numFrames = Math.floor(dataLength / bytesPerFrame);
        if (numFrames > 0) {
          const audioBuffer = ctx.createBuffer(numChannels, numFrames, sampleRate);
          for (let ch = 0; ch < numChannels; ch++) {
            const channelData = audioBuffer.getChannelData(ch);
            for (let i = 0; i < numFrames; i++) {
              const sampleIndex = dataOffset + (i * numChannels + ch) * 2;
              const int16Sample = view.getInt16(sampleIndex, true);
              channelData[i] = int16Sample / 32768.0;
            }
          }
          return audioBuffer;
        }
      }
    } catch {
      // Fall through to native decodeAudioData
    }
  }

  // Fallback to browser native decodeAudioData (handles both WAV and MP3 seamlessly)
  const copyBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
  return await ctx.decodeAudioData(copyBuffer);
}

// Monotonic generation ID to strictly prevent cancelled/previous speech from ever triggering fallback or overlapping
let currentSpeechGenerationId = 0;

// Global TTS state for smart acoustic echo suppression (prevents mic from picking up avatar's own voice)
let isTtsSpeakingGlobal = false;
let ttsCooldownUntilGlobal = 0;
let lastTtsSpokenTextGlobal = '';
let lastTtsEndedAtGlobal = 0;
let lastTtsStartTimeGlobal = 0;
let isProtectedTtsGlobal = false;
let isMainAnswerSpeakingGlobal = false;

// Global speaking avatar tracking for 3D real-time lip-sync ('avatar-1', 'chorus', or null)
let speakingAvatarIdGlobal: string | null = null;

const TTS_TAIL_COOLDOWN_MS = 500;

export function isAvatarSpeakingNow(avatarId?: string): boolean {
  if (!isTtsSpeakingGlobal || !speakingAvatarIdGlobal) return false;
  if (speakingAvatarIdGlobal === 'chorus' || speakingAvatarIdGlobal === 'any') {
    return true;
  }
  if (!avatarId) return true;
  return speakingAvatarIdGlobal === avatarId;
}

export function isMainAnswerSpeechActive(): boolean {
  return (
    isMainAnswerSpeakingGlobal &&
    Date.now() - lastTtsStartTimeGlobal < 25000
  );
}

export function isTtsActiveOrCoolingDown(): boolean {
  if (isTtsSpeakingGlobal) return true;
  if (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    window.speechSynthesis.speaking
  ) {
    return true;
  }
  return Date.now() < ttsCooldownUntilGlobal;
}

export function cancelActiveSpeech(
  force = false,
  allowCancelMainAnswer = false
): void {
  if (
    isMainAnswerSpeakingGlobal &&
    !allowCancelMainAnswer &&
    Date.now() - lastTtsStartTimeGlobal < 25000
  ) {
    return;
  }
  if (!force && isProtectedTtsGlobal && Date.now() - lastTtsStartTimeGlobal < 25000) {
    return;
  }
  const wasSpeaking =
    isTtsSpeakingGlobal ||
    activeAudioBufferSource !== null ||
    activeHtmlAudio !== null ||
    (typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      window.speechSynthesis.speaking);

  isProtectedTtsGlobal = false;
  isMainAnswerSpeakingGlobal = false;
  currentSpeechGenerationId++;
  isTtsSpeakingGlobal = false;
  speakingAvatarIdGlobal = null;
  if (wasSpeaking) {
    ttsCooldownUntilGlobal = Date.now() + 200;
    lastTtsEndedAtGlobal = Date.now();
  } else {
    lastTtsSpokenTextGlobal = '';
  }
  activeUtterances.clear();

  if (activeSpeechAbortController) {
    try {
      activeSpeechAbortController.abort();
    } catch {}
    activeSpeechAbortController = null;
  }

  if (activeAudioBufferSource) {
    const sourceToStop = activeAudioBufferSource;
    activeAudioBufferSource = null;
    try {
      sourceToStop.onended = null;
      sourceToStop.stop();
      sourceToStop.disconnect();
    } catch {}
  }

  if (activeHtmlAudio) {
    const audioToStop = activeHtmlAudio;
    activeHtmlAudio = null;
    try {
      audioToStop.onplay = null;
      audioToStop.onended = null;
      audioToStop.onerror = null;
      audioToStop.pause();
      audioToStop.removeAttribute('src');
    } catch {}
  }

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
}

/**
 * Preloads TTS audio into `clientTtsAudioCache`.
 * Deduplicates concurrent requests for the same (voiceName + text) and automatically retries transient network errors.
 */
export function preloadTtsAudio(
  text: string,
  role: RoleType,
  gender: 'male' | 'female',
  voiceName?: GeminiVoiceName,
  priority = true
): Promise<string | null> {
  if (globalVoiceEngineMode === 'browser') {
    return Promise.resolve(null);
  }
  const cleanText = text.trim();
  if (!cleanText) return Promise.resolve(null);

  const targetVoice = voiceName || getDefaultGeminiVoice(role, gender, 0);
  const cacheKey = `${targetVoice}::${cleanText}`;

  const cached = clientTtsAudioCache.get(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }

  const existingPromise = inFlightTtsPromises.get(cacheKey);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = (async (): Promise<string | null> => {
    const maxAttempts = 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetch('/api/presentation/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleanText,
            voiceName: targetVoice,
            role,
            gender,
            priority,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.audioBase64) {
            clientTtsAudioCache.set(cacheKey, data.audioBase64);
            clientTtsMetaCache.set(cacheKey, {
              mimeType: data.mimeType || 'audio/wav',
              isNeuralFallback: Boolean(data.isNeuralFallback),
            });
            return data.audioBase64 as string;
          }
        }
      } catch {
        // Retry after brief backoff
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    return null;
  })().finally(() => {
    inFlightTtsPromises.delete(cacheKey);
  });

  inFlightTtsPromises.set(cacheKey, promise);
  return promise;
}

// Varied, natural role-specific backchannels & bridging phrases (prevents robotic repetition)
export type FillerCategory =
  | 'callout_reply'
  | 'thinking_stage1'
  | 'thinking_stage2'
  | 'qa_eval_stage1'
  | 'qa_eval_stage2';

const FILLER_POOLS: Record<FillerCategory, Record<RoleType, string[]>> = {
  callout_reply: {
    professor: [
      'はい、何でしょうか？',
      'ええ、どうしましたか？',
      'はい、どうぞ。',
    ],
    peer: [
      'はい、どうしましたか？',
      'はい、何でしょうか？',
      'うん、どうしたの？',
    ],
    junior: [
      'はい！何でしょうか？',
      'はい、どうしましたか？',
      'はい！何でも聞いてください！',
    ],
  },
  thinking_stage1: {
    professor: [
      'うーーん、なるほど…',
      'ふーーむ、そうですね…',
      'なるほど〜〜〜、うーん…',
      'うーーん…',
      'ふーーむ…',
    ],
    peer: [
      'うーーん、なるほど〜〜…',
      'なるほど〜〜、そうですね…',
      'えーーっと、うーーん…',
      'うーーん…',
      'なるほど〜〜〜…',
    ],
    junior: [
      'えーーっと、うーーん…',
      'なるほど〜〜！えっと…',
      'うーーん、そうですね…',
      'なるほど〜〜〜…',
      'えーーっと…',
    ],
  },
  thinking_stage2: {
    professor: [
      'うーーーむ…',
      'そうですねーー…',
      'ふーーーむ…',
    ],
    peer: [
      'うーーーん…',
      'そうですねーー…',
      'えーーっと…',
    ],
    junior: [
      'うーーーん…',
      'えーーーっと…',
      'そうですねーー…',
    ],
  },
  qa_eval_stage1: {
    professor: [
      'なるほど〜〜、ふむふむ…',
      'うーーむ、なるほど…',
      'なるほど〜〜〜…',
      'ふーーむ、そうですね…',
    ],
    peer: [
      'なるほど〜〜、ふむふむ…',
      'あーー、なるほど〜〜…',
      'なるほどですねーー…',
      'うーーん、なるほど〜〜…',
    ],
    junior: [
      'なるほど〜〜〜！',
      'あーー、なるほどです…！',
      'ふむふむ、なるほど〜〜…',
      'えーーっと、なるほど…！',
    ],
  },
  qa_eval_stage2: {
    professor: [
      'ふーーーむ…',
      'なるほど〜〜…',
    ],
    peer: [
      'なるほどですねーー…',
      'うーーーん…',
    ],
    junior: [
      'なるほど〜〜〜…',
      'えーーーっと…',
    ],
  },
};

const lastUsedFillerIndexMap = new Map<string, number>();

export function pickVariedFiller(
  category: FillerCategory,
  role: RoleType,
  avatarId = 'default'
): string {
  const pool = FILLER_POOLS[category]?.[role] || FILLER_POOLS[category].peer;
  if (!pool || pool.length === 0) return 'そうですね…';
  if (pool.length === 1) return pool[0];

  const key = `${category}::${role}::${avatarId}`;
  const lastIdx = lastUsedFillerIndexMap.get(key) ?? -1;

  let nextIdx = Math.floor(Math.random() * pool.length);
  if (nextIdx === lastIdx) {
    nextIdx = (lastIdx + 1) % pool.length;
  }
  lastUsedFillerIndexMap.set(key, nextIdx);
  return pool[nextIdx];
}

/**
 * Unlocks Web Audio API and preloads core greetings and initial audience callout responses sequentially in background.
 */
export function warmupAudienceVoices(audience: AudienceMember[]): void {
  if (globalVoiceEngineMode === 'browser') return;
  getOrCreateTtsAudioContext();

  const tasks: Array<{
    text: string;
    role: RoleType;
    gender: 'male' | 'female';
    voiceName?: GeminiVoiceName;
  }> = [
    { text: 'こんにちは！', role: 'peer', gender: 'female', voiceName: 'Zephyr' },
    {
      text: 'おはようございます！',
      role: 'peer',
      gender: 'female',
      voiceName: 'Zephyr',
    },
    {
      text: 'よろしくお願いします！',
      role: 'peer',
      gender: 'female',
      voiceName: 'Zephyr',
    },
  ];

  audience.slice(0, 6).forEach((member) => {
    const firstCallout = FILLER_POOLS.callout_reply[member.role][0];
    tasks.push({
      text: firstCallout,
      role: member.role,
      gender: member.gender,
      voiceName: member.voiceName,
    });
  });

  (async () => {
    for (const item of tasks) {
      if (getGlobalVoiceEngineMode() === 'browser') break;
      await preloadTtsAudio(
        item.text,
        item.role,
        item.gender,
        item.voiceName,
        false
      );
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
}

function normalizeText(str: string): string {
  return str.replace(/[\s、。！？!?「」『』（）()・…]/g, '').trim();
}

/**
 * Checks whether two Japanese sentences are duplicates or near-duplicates (e.g. Chrome re-finalizing an interim utterance).
 */
export function isNearDuplicateSentence(a: string, b: string): boolean {
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  const minLen = Math.min(normA.length, normB.length);
  const maxLen = Math.max(normA.length, normB.length);
  if (
    (normA.includes(normB) || normB.includes(normA)) &&
    minLen / maxLen >= 0.78 &&
    maxLen - minLen <= 4
  ) {
    return true;
  }

  if (minLen >= 5 && maxLen - minLen <= 5) {
    const bigramsA = new Set<string>();
    for (let i = 0; i < normA.length - 1; i++) {
      bigramsA.add(normA.slice(i, i + 2));
    }
    let matches = 0;
    const totalB = normB.length - 1;
    for (let i = 0; i < totalB; i++) {
      if (bigramsA.has(normB.slice(i, i + 2))) {
        matches++;
      }
    }
    const overlap = matches / Math.max(1, Math.min(bigramsA.size, totalB));
    if (overlap >= 0.72 && minLen / maxLen >= 0.75) {
      return true;
    }
  }

  return false;
}

/**
 * Strips any prefix from `rawText` that was already emitted in `consumedPrefix`.
 */
function stripConsumedPrefix(rawText: string, consumedPrefix: string): string {
  if (!consumedPrefix || !rawText) return rawText;
  const trimmedRaw = rawText.trim();
  const trimmedConsumed = consumedPrefix.trim();

  if (trimmedRaw === trimmedConsumed) return '';
  if (trimmedRaw.startsWith(trimmedConsumed)) {
    return trimmedRaw
      .slice(trimmedConsumed.length)
      .replace(/^[、,。！？!?\s]+/, '')
      .trim();
  }

  const normRaw = normalizeText(trimmedRaw);
  const normConsumed = normalizeText(trimmedConsumed);
  if (!normRaw || normRaw === normConsumed) return '';
  if (isNearDuplicateSentence(normRaw, normConsumed)) return '';

  if (normRaw.startsWith(normConsumed) && normRaw.length > normConsumed.length) {
    // Walk through trimmedRaw until we have matched normConsumed.length normalized characters
    let matchedNormChars = 0;
    let cutIndex = 0;
    for (let i = 0; i < trimmedRaw.length; i++) {
      const ch = trimmedRaw[i];
      if (!/[\s、。！？!?「」『』（）()・…]/.test(ch)) {
        matchedNormChars++;
      }
      if (matchedNormChars >= normConsumed.length) {
        cutIndex = i + 1;
        break;
      }
    }
    return trimmedRaw
      .slice(cutIndex)
      .replace(/^[、,。！？!?\s]+/, '')
      .trim();
  }

  for (let tailLen = Math.min(7, trimmedConsumed.length); tailLen >= 3; tailLen--) {
    const tail = trimmedConsumed.slice(-tailLen);
    const idx = trimmedRaw.indexOf(tail);
    if (idx !== -1 && idx <= trimmedConsumed.length + 5) {
      return trimmedRaw
        .slice(idx + tail.length)
        .replace(/^[、,。！？!?\s]+/, '')
        .trim();
    }
  }

  return trimmedRaw;
}

/**
 * Checks whether a recognized phrase is an acoustic echo of the avatar's recent TTS speech.
 */
export function isLikelyTtsEcho(recognizedText: string): boolean {
  if (!lastTtsSpokenTextGlobal) return false;
  if (!isTtsActiveOrCoolingDown() && Date.now() - lastTtsEndedAtGlobal > 4000) {
    return false;
  }

  const normRec = normalizeText(recognizedText);
  const normTts = normalizeText(lastTtsSpokenTextGlobal);
  if (!normRec || !normTts) return false;

  if (normTts.includes(normRec) || normRec.includes(normTts)) {
    return true;
  }

  if (normRec.length >= 3 && normTts.length >= 3) {
    let matches = 0;
    const total = normRec.length - 2;
    for (let i = 0; i < total; i++) {
      const trigram = normRec.slice(i, i + 3);
      if (normTts.includes(trigram)) {
        matches++;
      }
    }
    if (total > 0 && matches / total >= 0.45) {
      return true;
    }
  }

  return false;
}

// Browser Web Speech API implementation (used ONLY when voiceEngineMode === 'browser' or total network outage)
function speakWithBrowserSpeech(
  text: string,
  role: RoleType,
  gender: 'male' | 'female',
  myGenId: number,
  onStart?: () => void,
  onEnd?: () => void,
  voiceName?: GeminiVoiceName,
  avatarId?: string
): () => void {
  if (myGenId !== currentSpeechGenerationId) {
    return () => {};
  }

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    isTtsSpeakingGlobal = true;
    speakingAvatarIdGlobal = avatarId || 'any';
    lastTtsSpokenTextGlobal = text;
    onStart?.();
    setTimeout(() => {
      if (myGenId !== currentSpeechGenerationId) return;
      isTtsSpeakingGlobal = false;
      speakingAvatarIdGlobal = null;
      lastTtsEndedAtGlobal = Date.now();
      ttsCooldownUntilGlobal = Date.now() + TTS_TAIL_COOLDOWN_MS;
      onEnd?.();
    }, 1500);
    return () => {};
  }

  window.speechSynthesis.cancel();
  activeUtterances.clear();

  isTtsSpeakingGlobal = true;
  speakingAvatarIdGlobal = avatarId || 'any';
  lastTtsSpokenTextGlobal = text;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ja-JP';

  const persona = getPersonaSettings(role, gender, voiceName);
  utterance.pitch = persona.pitch;
  utterance.rate = persona.rate;

  const voices = window.speechSynthesis.getVoices();
  const jaVoices = voices.filter((v) => v.lang.startsWith('ja'));

  if (jaVoices.length > 0) {
    if (persona.genderHint === 'female') {
      const femaleVoice = jaVoices.find(
        (v) =>
          v.name.includes('Kyoko') ||
          v.name.includes('Nanami') ||
          v.name.includes('Ayumi') ||
          v.name.includes('Haruka') ||
          v.name.includes('Female')
      );
      utterance.voice = femaleVoice || jaVoices[0];
    } else {
      const maleVoice = jaVoices.find(
        (v) =>
          v.name.includes('Otoya') ||
          v.name.includes('Ichiro') ||
          v.name.includes('Keita') ||
          v.name.includes('Male')
      );
      utterance.voice =
        maleVoice || (jaVoices.length > 1 ? jaVoices[1] : jaVoices[0]);
    }
  }

  let hasEnded = false;
  let watchdogTimer: any = null;

  const safeEnd = () => {
    if (hasEnded) return;
    hasEnded = true;
    if (watchdogTimer) clearTimeout(watchdogTimer);
    activeUtterances.delete(utterance);
    if (myGenId === currentSpeechGenerationId) {
      isTtsSpeakingGlobal = false;
      isProtectedTtsGlobal = false;
      isMainAnswerSpeakingGlobal = false;
      speakingAvatarIdGlobal = null;
      lastTtsEndedAtGlobal = Date.now();
      ttsCooldownUntilGlobal = Date.now() + TTS_TAIL_COOLDOWN_MS;
      onEnd?.();
    }
  };

  utterance.onstart = () => {
    if (myGenId !== currentSpeechGenerationId) {
      window.speechSynthesis.cancel();
      return;
    }
    isTtsSpeakingGlobal = true;
    speakingAvatarIdGlobal = avatarId || 'any';
    onStart?.();
    const estimatedMs = Math.max(2500, text.length * 200 + 3000);
    watchdogTimer = setTimeout(() => {
      safeEnd();
    }, estimatedMs);
  };

  utterance.onend = () => {
    safeEnd();
  };

  utterance.onerror = () => {
    safeEnd();
  };

  activeUtterances.add(utterance);
  window.speechSynthesis.speak(utterance);

  return () => {
    hasEnded = true;
    if (watchdogTimer) clearTimeout(watchdogTimer);
    activeUtterances.delete(utterance);
    if (myGenId === currentSpeechGenerationId) {
      window.speechSynthesis.cancel();
    }
  };
}

export interface SpeakTextOptions {
  voiceName?: GeminiVoiceName;
  avatarId?: string;
  forceEngine?: VoiceEngineMode;
  isProtected?: boolean;
  isMainAnswer?: boolean;
}

// Speak single text using Gemini TTS / Cloud Neural TTS with Web Audio API playback & L1/L2 caching
export function speakText(
  text: string,
  role: RoleType,
  gender: 'male' | 'female',
  onStart?: () => void,
  onEnd?: () => void,
  options?: SpeakTextOptions
): () => void {
  // アバターが質問に対して本回答を発話中（isMainAnswerSpeakingGlobal）は、次の発話リクエストが来ても完全にブロックする
  if (
    isMainAnswerSpeakingGlobal &&
    Date.now() - lastTtsStartTimeGlobal < 25000
  ) {
    return () => {};
  }

  cancelActiveSpeech(true, true);

  lastTtsStartTimeGlobal = Date.now();
  isProtectedTtsGlobal = Boolean(options?.isProtected);
  isMainAnswerSpeakingGlobal = Boolean(options?.isMainAnswer);

  const myGenId = ++currentSpeechGenerationId;
  const engineMode = options?.forceEngine || globalVoiceEngineMode;
  const targetVoice =
    options?.voiceName || getDefaultGeminiVoice(role, gender, 0);
  const avatarId = options?.avatarId || 'any';
  const cacheKey = `${targetVoice}::${text.trim()}`;

  if (engineMode === 'browser') {
    return speakWithBrowserSpeech(
      text,
      role,
      gender,
      myGenId,
      onStart,
      onEnd,
      targetVoice,
      avatarId
    );
  }

  let isCancelled = false;
  let hasEnded = false;

  // Immediately lock echo gate so mic doesn't trigger while fetching or playing TTS
  isTtsSpeakingGlobal = true;
  lastTtsSpokenTextGlobal = text;

  const isStale = () => isCancelled || myGenId !== currentSpeechGenerationId;

  const finishPlayback = () => {
    if (hasEnded) return;
    hasEnded = true;
    if (myGenId === currentSpeechGenerationId) {
      activeAudioBufferSource = null;
      activeHtmlAudio = null;
      activeSpeechAbortController = null;
      isTtsSpeakingGlobal = false;
      isProtectedTtsGlobal = false;
      isMainAnswerSpeakingGlobal = false;
      speakingAvatarIdGlobal = null;
      lastTtsEndedAtGlobal = Date.now();
      ttsCooldownUntilGlobal = Date.now() + TTS_TAIL_COOLDOWN_MS;
      if (!isCancelled) {
        onEnd?.();
      }
    }
  };

  const playWithHtmlAudioFallback = (audioBase64: string) => {
    if (isStale()) return;
    try {
      const meta = clientTtsMetaCache.get(cacheKey);
      const mimeType = meta?.mimeType || 'audio/wav';
      const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
      if (meta?.isNeuralFallback) {
        (audio as any).preservesPitch = false;
        audio.playbackRate = getNeuralFallbackPlaybackRate(targetVoice);
      }
      activeHtmlAudio = audio;

      audio.onplay = () => {
        if (isStale()) {
          audio.pause();
          return;
        }
        isTtsSpeakingGlobal = true;
        speakingAvatarIdGlobal = avatarId;
        onStart?.();
      };

      audio.onended = () => {
        finishPlayback();
      };

      audio.onerror = () => {
        finishPlayback();
      };

      audio.play().catch(() => {
        finishPlayback();
      });
    } catch {
      finishPlayback();
    }
  };

  const playBase64Wav = async (audioBase64: string) => {
    if (isStale()) return;
    const ctx = getOrCreateTtsAudioContext();
    if (ctx) {
      try {
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {});
        }
        const audioBuffer = await decodeWavBase64ToAudioBuffer(
          ctx,
          audioBase64
        );
        if (isStale()) return;

        const meta = clientTtsMetaCache.get(cacheKey);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        if (meta?.isNeuralFallback) {
          source.playbackRate.value = getNeuralFallbackPlaybackRate(targetVoice);
        }
        source.connect(ctx.destination);
        activeAudioBufferSource = source;

        source.onended = () => {
          finishPlayback();
        };

        isTtsSpeakingGlobal = true;
        speakingAvatarIdGlobal = avatarId;
        onStart?.();
        source.start(0);
        return;
      } catch {
        // If Web Audio API fails for any reason, try HTMLAudioElement with the same audio data
      }
    }
    playWithHtmlAudioFallback(audioBase64);
  };

  // Reuse cached or in-flight preload promise (with priority=true) so there is zero duplicate fetching!
  preloadTtsAudio(text, role, gender, targetVoice, true).then((audioBase64) => {
    if (isStale()) return;
    if (audioBase64) {
      playBase64Wav(audioBase64);
    } else {
      speakWithBrowserSpeech(
        text,
        role,
        gender,
        myGenId,
        onStart,
        onEnd,
        targetVoice,
        avatarId
      );
    }
  });

  return () => {
    isCancelled = true;
    if (myGenId === currentSpeechGenerationId) {
      cancelActiveSpeech();
    }
  };
}

/**
 * Plays a varied initial thinking backchannel immediately, and if the main LLM reply + its TTS audio
 * are not yet ready when the first backchannel ends, seamlessly bridges with a secondary thinking phrase
 * so there is never an awkward silent gap!
 */
export function runThinkingBridgeSequence(params: {
  role: RoleType;
  gender: 'male' | 'female';
  voiceName?: GeminiVoiceName;
  avatarId: string;
  stage1Category: FillerCategory;
  stage2Category: FillerCategory;
  onUpdateBubble?: (text: string) => void;
}): {
  waitForBridgeSlot: () => Promise<void>;
  cancelBridge: () => void;
} {
  const {
    role,
    gender,
    voiceName,
    avatarId,
    stage1Category,
    stage2Category,
    onUpdateBubble,
  } = params;

  const stage1Text = pickVariedFiller(stage1Category, role, avatarId);
  const stage2Text = pickVariedFiller(stage2Category, role, avatarId);

  let isReplyReady = false;
  let isAborted = false;
  let stage1Started = false;
  let stage1Ended = false;
  let stage1Timer: any = null;
  let stage2Timer: any = null;
  let currentStageFinishedResolve: (() => void) | null = null;

  const playStage2IfStillWaiting = () => {
    if (isAborted || isReplyReady) {
      const res = currentStageFinishedResolve;
      currentStageFinishedResolve = null;
      res?.();
      return;
    }

    onUpdateBubble?.(stage2Text);
    speakText(
      stage2Text,
      role,
      gender,
      () => {},
      () => {
        const res = currentStageFinishedResolve;
        currentStageFinishedResolve = null;
        res?.();
      },
      { voiceName, avatarId, isProtected: true }
    );
  };

  // Only play the thinking backchannel ("なるほど、そうですね…") if we are genuinely waiting for LLM + TTS generation!
  // If TTS generation finishes quickly (< 350ms) or is aborted because the presenter is still speaking, never play it.
  stage1Timer = setTimeout(() => {
    stage1Timer = null;
    if (isReplyReady || isAborted) {
      const res = currentStageFinishedResolve;
      currentStageFinishedResolve = null;
      res?.();
      return;
    }

    stage1Started = true;
    onUpdateBubble?.(stage1Text);

    speakText(
      stage1Text,
      role,
      gender,
      () => {
        if (!isReplyReady && !isAborted) {
          preloadTtsAudio(stage2Text, role, gender, voiceName, false);
        }
      },
      () => {
        stage1Ended = true;
        if (isReplyReady || isAborted) {
          const res = currentStageFinishedResolve;
          currentStageFinishedResolve = null;
          res?.();
        } else {
          // Main reply isn't ready yet! Seamlessly bridge with Stage 2 instead of leaving dead silence
          stage2Timer = setTimeout(() => {
            stage2Timer = null;
            playStage2IfStillWaiting();
          }, 120);
        }
      },
      { voiceName, avatarId, isProtected: true }
    );
  }, 350);

  return {
    waitForBridgeSlot: () => {
      isReplyReady = true;
      if (stage1Timer) {
        clearTimeout(stage1Timer);
        stage1Timer = null;
      }
      if (stage2Timer) {
        clearTimeout(stage2Timer);
        stage2Timer = null;
      }
      if (!stage1Started || (stage1Ended && !isTtsSpeakingGlobal)) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          currentStageFinishedResolve = null;
          resolve();
        };
        const safetyTimer = setTimeout(() => {
          done();
        }, 2200);
        currentStageFinishedResolve = () => {
          clearTimeout(safetyTimer);
          setTimeout(done, 80);
        };
      });
    },
    cancelBridge: () => {
      isAborted = true;
      if (stage1Timer) {
        clearTimeout(stage1Timer);
        stage1Timer = null;
      }
      if (stage2Timer) {
        clearTimeout(stage2Timer);
        stage2Timer = null;
      }
      const res = currentStageFinishedResolve;
      currentStageFinishedResolve = null;
      cancelActiveSpeech(true);
      res?.();
    },
  };
}

// Speak unified chorus voice for audience collective responses
export function speakChorus(
  text: string,
  onStart?: () => void,
  onEnd?: () => void
): () => void {
  return speakText(text, 'peer', 'female', onStart, onEnd, {
    voiceName: 'Zephyr',
    avatarId: 'chorus',
  });
}

export function speakMultiVoices(
  speeches: Array<{ text: string; role: RoleType; gender: 'male' | 'female' }>,
  onStart?: () => void,
  onEnd?: () => void
): () => void {
  const primaryText = speeches[0]?.text || 'よろしくお願いします！';
  return speakChorus(primaryText, onStart, onEnd);
}

export interface SpeechRecognitionHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
  onStatusChange?: (isListening: boolean) => void;
}

export function isJapaneseSentenceEnding(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;

  if (/[。！？!?]$/.test(clean)) return true;

  if (
    /(です|ます|でした|ました|ません|ございません|ございました|ございます)[。！？!?]?$/.test(
      clean
    )
  ) {
    return true;
  }
  if (
    /(あります|ありません|おります|おりません|いたします|致します|行います|行いました|存じます|申し上げます)[。！？!?]?$/.test(
      clean
    )
  ) {
    return true;
  }

  if (
    /(思います|思われます|考えております|考えられます|期待されます|示唆されます|示唆されました|推察されます|推察いたしました)[。！？!?]?$/.test(
      clean
    )
  ) {
    return true;
  }

  if (
    /(始めます|始めさせていただきます|発表します|発表いたします|発表させていただきます|説明します|説明いたします)[。！？!?]?$/.test(
      clean
    )
  ) {
    return true;
  }
  if (
    /(終わります|終了します|終了いたします|以上です|以上となります|以上になります)[。！？!?]?$/.test(
      clean
    )
  ) {
    return true;
  }
  if (
    /(お願いいたします|お願い致します|よろしくお願いします|何卒よろしくお願い申し上げます)[。！？!?]?$/.test(
      clean
    )
  ) {
    return true;
  }

  if (
    /(\?|？|でしょうか|どうでしょうか|いかがでしょうか|質問です|ですか|ますか|でしたか|ませんか|ありませんか|ありますか|やってますか|どうですか|いかがですか|経験ありますか|経験ありませんか|どう思う|どう思われますか|どうでしょう|どう|いかが|意見|所感|感想|考え|見解|コメント|コスト|理由|なぜ|何|どれ|どこ|教えて|聞かせて|伺いたい|お聞きしたい|意見ある|意見はありますか|考えたこと|挙げてください|あげてください|挙げてみて|あげてみて|いますか|いらっしゃいますか)[。！？!?]?$/.test(
      clean
    ) ||
    /(どう|いかが|何|なぜ|理由|コスト|方法|手法|効果|概要|詳細|意見|見解|コメント|教えて)/.test(clean)
  ) {
    return true;
  }

  if (
    /(さん|先生|教授|准教授|くん|君|様)[。！？!?、,]?$/.test(clean) &&
    clean.length >= 2
  ) {
    return true;
  }

  if (
    /(おはようございます|こんにちは|こんばんは|ご清聴ありがとうございました|ありがとうございました|ください|お願いいたします|お願い致します)[。！？!?]?$/.test(
      clean
    )
  ) {
    return true;
  }

  return false;
}

export function isJapaneseIncompleteClause(text: string): boolean {
  const clean = text.trim();
  if (!clean) return true;

  if (/[？?]$/.test(clean)) return false;
  if (/(さん|先生|教授|准教授|くん|君)[は、,]?$/.test(clean)) return false;

  if (/[はがをにへとでのやも]$/.test(clean)) return true;
  if (/(から|ので|けど|けれど|ですが|ながら|たり|たら|なら|ば)$/.test(clean)) {
    return true;
  }

  if (
    /(そして|また|さらに|次に|一方で|しかし|しかしながら|なお|つまり|具体的には)$/.test(
      clean
    )
  ) {
    return true;
  }

  if (/(て|で|しまして|行い|用いて|考えて|あり|おり)$/.test(clean)) {
    return true;
  }
  if (
    /(について|に関して|において|によって|により|に対して|として|を通じて|を踏まえて|に沿って)$/.test(
      clean
    )
  ) {
    return true;
  }
  if (/(という|といった|などの)$/.test(clean)) {
    return true;
  }

  if (/[、,]$/.test(clean)) return true;

  return false;
}

function isAndroidBrowser(): boolean {
  return (
    typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
  );
}

export class PresentationSpeechRecognizer {
  private recognition: any = null;
  private isExplicitlyStopped = false;
  private handlers: SpeechRecognitionHandlers;
  private bufferedSentence = '';
  private currentInterim = '';
  private flushTimer: any = null;
  private restartTimer: any = null;
  private recentEmittedSentences: Array<{ text: string; time: number }> = [];
  private ignoredResultIndexUpTo = -1;
  private consumedTextByIndex: Map<number, string> = new Map();
  private lastActiveInterimIndex = -1;
  private lastActiveRawInterimText = '';
  private isAndroid = false;

  constructor(handlers: SpeechRecognitionHandlers) {
    this.handlers = handlers;
    this.isAndroid = isAndroidBrowser();
    this.initRecognition();
  }

  private initRecognition() {
    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('SpeechRecognition API not available in this browser.');
      this.handlers.onError(
        'このブラウザは音声認識APIに対応していません（Google Chrome推奨）。'
      );
      return;
    }

    try {
      this.recognition = new SpeechRecognition();
      // Android版Chromeでは continuous = true にすると累積重複バグや無音ロックが発生するため、
      // Androidでは continuous = false + onend自動再起動で安定動作させる
      this.recognition.continuous = !this.isAndroid;
      this.recognition.interimResults = true;
      this.recognition.lang = 'ja-JP';
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
        this.ignoredResultIndexUpTo = -1;
        this.consumedTextByIndex.clear();
        this.lastActiveInterimIndex = -1;
        this.lastActiveRawInterimText = '';
        this.handlers.onStatusChange?.(true);
      };

      this.recognition.onresult = (event: any) => {
        let interimTranscript = '';
        const startIdx = Math.max(
          event.resultIndex || 0,
          this.ignoredResultIndexUpTo + 1
        );

        for (let i = startIdx; i < event.results.length; ++i) {
          const item = event.results[i];
          const rawTranscript = (item[0]?.transcript || '').trim();
          if (!rawTranscript) continue;

          const alreadyConsumed = this.consumedTextByIndex.get(i) || '';
          const transcript = alreadyConsumed
            ? stripConsumedPrefix(rawTranscript, alreadyConsumed)
            : rawTranscript;

          if (!transcript) {
            if (item.isFinal) {
              this.ignoredResultIndexUpTo = Math.max(this.ignoredResultIndexUpTo, i);
            }
            continue;
          }

          if (isLikelyTtsEcho(transcript)) {
            if (item.isFinal) {
              this.ignoredResultIndexUpTo = Math.max(this.ignoredResultIndexUpTo, i);
            }
            continue;
          }

          if (item.isFinal) {
            this.ignoredResultIndexUpTo = Math.max(this.ignoredResultIndexUpTo, i);
            this.consumedTextByIndex.delete(i);
            if (this.bufferedSentence) {
              if (transcript.startsWith(this.bufferedSentence)) {
                // Android Chrome cumulative result protection
                this.bufferedSentence = transcript;
              } else if (
                !this.bufferedSentence.endsWith(transcript) &&
                !isNearDuplicateSentence(this.bufferedSentence, transcript)
              ) {
                this.bufferedSentence += transcript;
              }
            } else {
              this.bufferedSentence = transcript;
            }
          } else {
            if (
              interimTranscript &&
              transcript.startsWith(interimTranscript)
            ) {
              interimTranscript = transcript;
            } else if (
              !interimTranscript.endsWith(transcript)
            ) {
              interimTranscript += transcript;
            }
            this.lastActiveInterimIndex = i;
            this.lastActiveRawInterimText = rawTranscript;
          }
        }

        this.currentInterim = interimTranscript;

        const preview = (this.bufferedSentence + interimTranscript).trim();

        if (!preview || isLikelyTtsEcho(preview)) {
          return;
        }

        // 保護されていないTTS再生中で、かつ発表者が明確に発話した場合のみ中断する（保護された回答・コメント再生中は絶対に中断しない）
        if (
          isTtsActiveOrCoolingDown() &&
          !isProtectedTtsGlobal &&
          Date.now() - lastTtsStartTimeGlobal > 1800 &&
          preview.length >= 4
        ) {
          cancelActiveSpeech(false);
        }

        this.handlers.onInterim(preview);

        if (this.flushTimer) {
          clearTimeout(this.flushTimer);
          this.flushTimer = null;
        }

        const hasTerminal = isJapaneseSentenceEnding(preview);
        const isIncomplete = isJapaneseIncompleteClause(preview);
        // 純粋な呼びかけ（佐藤さん等）または明確な疑問文末のときのみ素早くフラッシュし、文中の名詞（質問・意見など）で途中切断しない
        const isPureHonorificCallout =
          /^.{1,12}(さん|先生|教授|准教授|くん|君)[。、！？!?\s]*$/.test(
            preview
          );
        const isExplicitQuestionEnd =
          /(\?|？|でしょうか|ですか|ますか|ませんか|ありますか|ありませんか|どう思われますか|どう思いますか|どうですか|いかがですか|いかがでしょうか|教えてください|聞かせてください|お願いします|お願いいたします)[。！？!?]?$/.test(
            preview
          );

        let delay: number;
        if (isPureHonorificCallout && preview.length >= 2) {
          delay = 300;
        } else if (isExplicitQuestionEnd && preview.length >= 3) {
          delay = 380;
        } else if (hasTerminal && preview.length >= 4) {
          delay = 500;
        } else if (isIncomplete) {
          delay = 2200;
        } else {
          delay = 1400;
        }

        if (preview.length > 80 && delay > 1200) {
          delay = 1200;
        }

        this.flushTimer = setTimeout(() => {
          this.flushBuffer();
        }, delay);
      };

      this.recognition.onerror = (event: any) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          this.handlers.onError(
            'マイクへのアクセスが拒否されています。アドレスバーのアイコンからマイクを許可してください。'
          );
          this.handlers.onStatusChange?.(false);
        } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
          console.warn('Speech recognition notice:', event.error);
        }
      };

      this.recognition.onend = () => {
        this.ignoredResultIndexUpTo = -1;
        this.consumedTextByIndex.clear();
        this.lastActiveInterimIndex = -1;
        this.lastActiveRawInterimText = '';
        if (this.isExplicitlyStopped) {
          this.handlers.onStatusChange?.(false);
          if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
          }
          if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
          }
          this.bufferedSentence = '';
          this.currentInterim = '';
          return;
        }

        // Android版Chrome等で isFinal が発火する前にセッションが終了した場合、
        // 認識途中の currentInterim が消えないよう bufferedSentence に引き継ぐ
        if (this.currentInterim) {
          const interimText = this.currentInterim.trim();
          this.currentInterim = '';
          if (interimText && !isLikelyTtsEcho(interimText)) {
            if (this.bufferedSentence) {
              if (interimText.startsWith(this.bufferedSentence)) {
                this.bufferedSentence = interimText;
              } else if (
                !this.bufferedSentence.endsWith(interimText) &&
                !isNearDuplicateSentence(this.bufferedSentence, interimText)
              ) {
                this.bufferedSentence += interimText;
              }
            } else {
              this.bufferedSentence = interimText;
            }
          }
        }

        if (this.isAndroid && this.bufferedSentence.trim()) {
          if (this.flushTimer) {
            clearTimeout(this.flushTimer);
          }
          this.flushTimer = setTimeout(() => {
            this.flushBuffer();
          }, 350);
        }

        if (this.restartTimer) {
          clearTimeout(this.restartTimer);
        }

        // Android OSのSpeechRecognizerサービスが前セッションのマイクを解放するまで少し待ってから再起動する
        const restartDelayMs = this.isAndroid ? 200 : 40;
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          if (this.isExplicitlyStopped) return;
          try {
            this.recognition?.start();
          } catch {
            setTimeout(() => {
              if (!this.isExplicitlyStopped) {
                try {
                  this.recognition?.start();
                } catch {}
              }
            }, 220);
          }
        }, restartDelayMs);
      };
    } catch (err) {
      console.error('Failed to instantiate SpeechRecognition:', err);
      this.handlers.onError('音声認識の初期化に失敗しました。');
    }
  }

  private flushBuffer() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const candidate = (this.bufferedSentence + this.currentInterim).trim();

    if (!candidate) return;

    if (isLikelyTtsEcho(candidate)) {
      this.bufferedSentence = '';
      this.currentInterim = '';
      this.handlers.onInterim('');
      return;
    }

    if (isTtsActiveOrCoolingDown() && !isProtectedTtsGlobal) {
      cancelActiveSpeech(false);
    }

    if (
      candidate.length <= 4 &&
      /^(えー|ええ|あの|その|うーん|えっと|はい|うん)[、。]?$/.test(candidate)
    ) {
      return;
    }

    const now = Date.now();
    this.recentEmittedSentences = this.recentEmittedSentences.filter(
      (item) => now - item.time < 12000
    );

    let cleanCandidate = candidate;
    if (this.recentEmittedSentences.length > 0) {
      const lastEmitted =
        this.recentEmittedSentences[this.recentEmittedSentences.length - 1].text;
      if (cleanCandidate === lastEmitted) {
        cleanCandidate = '';
      } else if (cleanCandidate.startsWith(lastEmitted)) {
        cleanCandidate = cleanCandidate
          .slice(lastEmitted.length)
          .replace(/^[、,。！？!?\s]+/, '')
          .trim();
      }
    }

    if (!cleanCandidate || cleanCandidate.length < 2) {
      this.bufferedSentence = '';
      this.currentInterim = '';
      this.handlers.onInterim('');
      return;
    }

    const isDuplicate = this.recentEmittedSentences.some((item) =>
      isNearDuplicateSentence(cleanCandidate, item.text)
    );

    if (isDuplicate) {
      this.bufferedSentence = '';
      this.currentInterim = '';
      this.handlers.onInterim('');
      return;
    }

    if (this.currentInterim && this.lastActiveInterimIndex >= 0) {
      this.consumedTextByIndex.set(
        this.lastActiveInterimIndex,
        this.lastActiveRawInterimText
      );
    }

    this.recentEmittedSentences.push({ text: cleanCandidate, time: now });
    this.bufferedSentence = '';
    this.currentInterim = '';
    this.handlers.onInterim('');
    this.handlers.onFinal(cleanCandidate);
  }

  public clearBuffer() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.currentInterim && this.lastActiveInterimIndex >= 0) {
      this.consumedTextByIndex.set(
        this.lastActiveInterimIndex,
        this.lastActiveRawInterimText
      );
    }
    this.bufferedSentence = '';
    this.currentInterim = '';
  }

  public start() {
    this.isExplicitlyStopped = false;
    this.bufferedSentence = '';
    this.currentInterim = '';
    this.ignoredResultIndexUpTo = -1;
    this.consumedTextByIndex.clear();
    this.lastActiveInterimIndex = -1;
    this.lastActiveRawInterimText = '';
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.start();
      } catch (e) {}
    }
  }

  public stop() {
    this.isExplicitlyStopped = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.bufferedSentence = '';
    this.currentInterim = '';
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }
  }
}

export interface FastPathGreetingResult {
  isGreeting: boolean;
  isTargeted: boolean;
  targetAvatarId?: string;
  targetRoleOrName?: string;
  targetRole?: RoleType;
  targetGender?: 'male' | 'female';
  replyText: string;
  chorusReplies: string[];
}

export function getMatchingGreetingReply(text: string): string | null {
  const clean = text.replace(/[\s、。！？!?「」『』（）()・…]/g, '');
  if (!clean || clean.length > 26) return null;

  // 注意: 「今日は」（きょうは＝本日）や文中の「始めます」を含めると、
  // 発表本編の「今日は〇〇について発表します」「説明を始めます」で誤爆するため除外する
  if (clean.includes('こんにちは')) {
    return 'こんにちは！';
  }
  if (clean.includes('こんばんは')) {
    return 'こんばんは！';
  }
  if (clean.includes('おはようございます') || clean.includes('おはよう')) {
    return 'おはようございます！';
  }
  if (
    clean.includes('よろしくお願いします') ||
    clean.includes('よろしくお願いいたします')
  ) {
    return 'よろしくお願いします！';
  }
  return null;
}

export function detectFastPathGreeting(
  text: string,
  _audience?: Array<{ id: string; name: string; role: RoleType; gender: 'male' | 'female' }>
): FastPathGreetingResult | null {
  const replyText = getMatchingGreetingReply(text);
  if (!replyText) return null;

  return {
    isGreeting: true,
    isTargeted: false,
    replyText,
    chorusReplies: [replyText],
  };
}

export function isMeaningfulSpeechUtterance(text: string): boolean {
  const clean = text
    .replace(/[\s、。！？!?「」『』（）()・…]/g, '')
    .replace(/^(えー+|ええ+|あのー*|そのー*|うーん+|えっとー*|ん+|あ+|は+|っ+)+/g, '')
    .trim();

  if (clean.length < 2) return false;
  if (/^(あ|い|う|え|お|ん|は|うん|はい|えー|あの|その)$/.test(clean)) {
    return false;
  }
  return true;
}

export function isExplicitQuestionUtterance(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;

  if (/[？?]$/.test(clean)) return true;

  return /(ですか|ますか|ましたか|でしたか|でしょうか|ませんか|ありませんか|ありますか|いますか|いらっしゃいますか|やってますか|やっていますか|どう思|どう考|どうでしょう|どうですか|いかが|なぜ|どこ|どのよう|どれ|いつ|誰|だれ|何|なに|意見|感想|コメント|見解|教えて|聞かせて|伺いたい|お聞きしたい|お願い)[。！？!?]?/.test(
    clean
  );
}

export function isPresentationEndPhrase(text: string): boolean {
  const clean = text.replace(/[\s、。！？!?「」『』（）()・…]/g, '').trim();
  if (!clean) return false;

  const endPatterns = [
    /(これで|以上で|それでは|では|これにて|以上をもちまして|以上をもって)?(私からの|私たちの|本日の|今回の|私の)?(発表|プレゼン|プレゼンテーション|説明|報告|お話|スピーチ)?(は|を)?(終わります|終わりたいと思います|終了します|終了いたします|終了させていただきます|終わりにします|終わりにしたいと思います|締めさせていただきます|おしまいにします|おしまいです|完了します)/,
    /ご(清聴|静聴|傾聴)(いただき|くださり)?(誠に|どうも)?(ありがとう|感謝)/,
    /(発表|プレゼン|プレゼンテーション|説明|報告)は以上(です|となります|になります|とさせていただきます)/,
    /(これで|以上で|本日は|私からは)以上(です|となります|になります|とさせていただきます)/,
    /(聞いて|お聞き)(いただき|くださり|くれて)(誠に|どうも)?ありがとうございました/,
    /^(以上で|これで)?(終わります|終了します|終了いたします|終わりにします|おしまいです|以上です|以上となります|以上になります)$/,
    /(ご清聴|ご静聴)?ありがとうございました$/,
  ];

  return endPatterns.some((pattern) => pattern.test(clean));
}

export interface NominationCheckResult {
  isPureNomination: boolean;
  substantiveText: string;
}

/**
 * Checks whether an utterance that references an audience avatar is a pure nomination callout
 * (e.g. "佐藤さん", "佐藤先生どうぞ", "佐藤さんに質問します", "佐藤さんを指名します")
 * vs an already substantive question or opinion prompt (e.g. "佐藤さん、練習どこでやってますか", "佐藤さん、どう思いますか").
 */
export function checkNominationCallout(
  input: string,
  avatarName: string
): NominationCheckResult {
  const familyName = avatarName.replace(/[\s(（].*$/, '').trim();
  let stripped = input
    .replace(new RegExp(familyName, 'g'), '')
    .replace(/(先生|教授|准教授|講師|助教|さん|くん|君|様|氏)/g, '');

  // Only strip pure nomination/callout prefaces (never strip actual questions or opinion requests!)
  const calloutPhrases = [
    'にお聞きしたいと思います',
    'にお聞きしたいのですが',
    'にお聞きしたいんだけど',
    'にお聞きします',
    'に聞いてみたいと思います',
    'に聞いてみたいのですが',
    'に聞いてみたいんだけど',
    'に聞いてみます',
    'にお伺いしたいと思います',
    'にお伺いします',
    'に伺います',
    'に質問したいと思います',
    'に質問したいのですが',
    'に質問したいんだけど',
    'に質問させていただきます',
    'に質問します',
    'に質問です',
    '質問したいと思います',
    '質問したいのですが',
    '質問したいんだけど',
    '質問させていただきます',
    '質問します',
    '質問です',
    '質問があります',
    '質問してもいいですか',
    '質問いいですか',
    'ちょっと聞きたいのですが',
    'ちょっと聞きたいんだけど',
    '聞きたいのですが',
    '聞きたいんだけど',
    'に当てたいと思います',
    'に当てます',
    'を当てたいと思います',
    'を当てます',
    '当てたいと思います',
    '当てますね',
    '当てます',
    'あてます',
    'を指名させていただきます',
    'を指名したいと思います',
    'を指名します',
    '指名させていただきます',
    '指名したいと思います',
    '指名します',
    '聞こえますでしょうか',
    '聞こえますか',
    'きこえますか',
    'マイクをオンにしてください',
    'マイクをオンに',
    'どうぞよろしく',
    'どうぞ',
    'それでは',
    'それじゃあ',
    'では',
    'じゃあ',
    '次に',
    '続いて',
    'ここで',
    'せっかくなので',
    'ちなみに',
    'こんにちは',
    'こんばんは',
    'おはようございます',
    'ちょっと',
    'えーっと',
    'えーと',
    'あのー',
    'あの',
    'ええと',
    'そうですね',
    'はい',
  ];

  for (const phrase of calloutPhrases) {
    stripped = stripped.split(phrase).join('');
  }

  const substantive = stripped
    .replace(/^[はがをにへとのも、。！？!?\s]+/, '')
    .replace(/[\s、。！？!?「」『』（）()・…~〜]/g, '')
    .trim();

  // If what remains is only "お願いします" / "よろしくお願いします" with no other topic or question word, it's a pure nomination
  const isBarePlease =
    /^(よろしく)?(お願い|おねがい)(いたします|します|できますか|できますでしょうか|ね)?$/.test(
      substantive
    );

  return {
    isPureNomination: isBarePlease || substantive.length < 2,
    substantiveText: isBarePlease ? '' : substantive,
  };
}


