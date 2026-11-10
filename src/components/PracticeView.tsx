import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  PresentationConfig,
  AudienceMember,
  TranscriptPoint,
  QuestionItem,
  HandRaiseHistoryEntry,
} from '../types/presentation';
import {
  Audience3DStage,
  SneezeEventTrigger,
  AudienceMood,
} from './Audience3DStage';
import {
  PresentationSpeechRecognizer,
  speakText,
  cancelActiveSpeech,
  speakChorus,
  detectFastPathGreeting,
  FastPathGreetingResult,
  isNearDuplicateSentence,
  getMatchingGreetingReply,
  isExplicitQuestionUtterance,
  isMeaningfulSpeechUtterance,
  preloadTtsAudio,
  runThinkingBridgeSequence,
  warmupAudienceVoices,
  checkNominationCallout,
  isPresentationEndPhrase,
} from '../utils/speech';
import {
  playApplauseSound,
  playSneezeOrCoughSound,
} from '../utils/soundEffects';
import { AudioSentenceRecorder } from '../utils/audioRecorder';
import {
  Mic,
  Clock,
  ArrowRight,
  Eye,
  EyeOff,
  CheckCircle2,
  Volume2,
  Subtitles,
  Brain,
  AlertCircle,
  FlipHorizontal2,
  ZoomIn,
  ZoomOut,
  MoveDiagonal2,
} from 'lucide-react';

const MIN_WEBCAM_WIDTH = 160;
const MAX_WEBCAM_WIDTH = 680;
const DEFAULT_WEBCAM_WIDTH = 280;

interface PracticeViewProps {
  config: PresentationConfig;
  mediaStream: MediaStream | null;
  onFinishToQA: (
    transcript: TranscriptPoint[],
    questions: QuestionItem[],
    elapsedSeconds: number,
    showAvatarSubtitles: boolean
  ) => void;
}

function createClientDynamicFallback(
  userQuestion: string,
  role: string,
  avatarName: string,
  avatar?: AudienceMember,
  handRaiseHistory?: HandRaiseHistoryEntry[]
): string {
  const cleanQ = (userQuestion || '').trim();
  const combinedBio = [
    avatar?.profile || '',
    ...(Array.isArray(avatar?.learnedTraits) ? avatar.learnedTraits : []),
  ]
    .filter(Boolean)
    .join(' / ');

  const raisedPrompts =
    Array.isArray(handRaiseHistory) && avatar?.id
      ? handRaiseHistory
          .filter((h) => h.raisedAvatarIds.includes(avatar.id))
          .map((h) => h.prompt)
      : [];
  const notRaisedPrompts =
    Array.isArray(handRaiseHistory) && avatar?.id
      ? handRaiseHistory
          .filter((h) => !h.raisedAvatarIds.includes(avatar.id))
          .map((h) => h.prompt)
      : [];

  if (/(どこに行|どこへ行|どの国|何処に行|旅行先|行った場所)/.test(cleanQ)) {
    const wentAbroad =
      raisedPrompts.some((p) => /(海外|旅行|パスポート|留学)/.test(p)) ||
      /(海外|留学|旅行|ハワイ|台湾|ヨーロッパ|アメリカ|韓国)/.test(combinedBio);
    const neverWentAbroad =
      notRaisedPrompts.some(
        (p) => /(海外|旅行)/.test(p) && !/(ない人|ない方)/.test(p)
      );

    if (neverWentAbroad && !wentAbroad) {
      return role === 'professor'
        ? '実は先ほど手を挙げなかった通り、まだ海外には行ったことがないのですが、国内の学会にはよく足を運んでいます。'
        : role === 'junior'
        ? '実は私、さっき手を挙げなかった通りまだ海外には行ったことがないんです！これからぜひ行ってみたいです！'
        : '実は先ほど手を挙げなかった通り、まだ海外には行ったことがないんですよね。国内旅行ならよく行きます。';
    }
    return role === 'professor'
      ? '国際学会と視察を兼ねて、アメリカのボストンやドイツのミュンヘンに滞在したことがあります。'
      : role === 'junior'
      ? '大学の夏休みに友人と台湾とハワイへ行きました！とても良い経験になりました！'
      : '昨年、ゼミの休暇を利用して韓国とシンガポールへ旅行に行きました。とても印象に残っています。';
  }

  const topicMatch = cleanQ.match(/([一-龠ぁ-んァ-ヶa-zA-Z0-9]{2,14})(について|に関して|の|は|が|\?|？|って)/);
  const keyTopic = topicMatch ? topicMatch[1] : (cleanQ.slice(0, 15) || 'ご指摘の点');

  const isCost = /(コスト|費用|価格|予算|課金|無料)/.test(cleanQ);
  const isSpeed = /(速度|レスポンス|遅延|パフォーマンス|早い|高速)/.test(cleanQ);
  const isTech = /(技術|モデル|API|アルゴリズム|精度|仕組み|設計)/.test(cleanQ);

  if (role === 'professor') {
    if (isCost) {
      return `「${keyTopic}」の費用対効果についてですが、初期投資と運用コストの回収モデルが明確に示されており、実現可能性の高い試算だと評価できます。`;
    }
    if (isSpeed) {
      return `「${keyTopic}」の処理性能について、リアルタイム性を重視したアーキテクチャの妥当性がしっかりデータで担保されている点が秀逸です。`;
    }
    if (isTech) {
      return `「${keyTopic}」の技術的選定についてですが、既存手法の課題を的確に捉えた上で必然性のある選定が行われており、学術的・工学的に説得力があります。`;
    }
    return `「${keyTopic}」の論点ですが、発表内で示された論理構成と検証データの整合性を踏まえると、極めて妥当で完成度の高い考察だと捉えています。`;
  } else if (role === 'junior') {
    if (isCost) {
      return `「${keyTopic}」のコスト面、とても現実的で分かりやすかったです！これなら実際のプロダクトでも導入しやすそうだと感じました！`;
    }
    if (isTech || isSpeed) {
      return `「${keyTopic}」の技術的な仕組み、とても勉強になりました！工夫されているポイントが具体的に伝わってきて面白かったです！`;
    }
    return `「${keyTopic}」について、発表の中でとても明快に解説していただいたのでよく理解できました！自分にとっても大きな刺激になりました！`;
  } else {
    // peer
    if (isCost) {
      return `「${keyTopic}」のコスト面ですが、スケーラビリティを考慮しても無駄がなく、持続可能な現実的アプローチだと共感しました。`;
    }
    if (isSpeed) {
      return `「${keyTopic}」のレスポンス設計ですが、体感速度を落とさない工夫が的確で、実際のユーザー体験にも直結する良い判断だと思います。`;
    }
    if (isTech) {
      return `「${keyTopic}」のアーキテクチャ設計は、保守性と拡張性のバランスが取れていて非常にスマートな実装だと感じました。`;
    }
    return `「${keyTopic}」の視点について、現場での実運用やトレードオフをしっかり見据えた非常に具体的で実効性の高い取り組みだと感じました。`;
  }
}

export const PracticeView: React.FC<PracticeViewProps> = ({
  config,
  mediaStream,
  onFinishToQA,
}) => {
  // Audience list state with animated reactions
  const [audience, setAudience] = useState<AudienceMember[]>(config.audience);
  const [audienceMood, setAudienceMood] = useState<AudienceMood>('normal');
  const [raisedHandRatio, setRaisedHandRatio] = useState<number>(0);
  const [handRaiseTopicKey, setHandRaiseTopicKey] = useState<string>('');
  const [isNegativeHandRaise, setIsNegativeHandRaise] = useState<boolean>(false);
  const [sleepingRatio, setSleepingRatio] = useState<number>(0);
  const [sneezeTrigger, setSneezeTrigger] = useState<SneezeEventTrigger | null>(
    null
  );

  // Thinking / Pondering Toast State
  const [thinkingState, setThinkingState] = useState<{
    isThinking: boolean;
    text?: string;
    avatarName?: string;
  } | null>(null);

  // Avatar subtitle display state (initialized from SetupView config)
  const [showAvatarSubtitles, setShowAvatarSubtitles] = useState<boolean>(
    config.showAvatarSubtitles
  );

  // Timer states
  const totalDurationSec = config.durationMinutes * 60;
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [isPaused] = useState<boolean>(false);

  // Voice activity & analysis status for the Oscilloscope monitor
  const [isCurrentlySpeaking, setIsCurrentlySpeaking] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [recognizedCount, setRecognizedCount] = useState<number>(0);

  // Transcript log (stores exact spoken sentences without duplicates)
  const [transcriptLog, setTranscriptLog] = useState<TranscriptPoint[]>([]);

  // Automatic End-of-Presentation Transition Alert
  const [endNotification, setEndNotification] = useState<{
    show: boolean;
    countdown: number;
  }>({ show: false, countdown: 4 });
  const endTimerRef = useRef<any>(null);
  const [spendCapWarning, setSpendCapWarning] = useState<string | null>(null);

  // Audience response state (General vs Targeted)
  const [focusAvatarId, setFocusAvatarId] = useState<string | null>(null);
  const focusAvatarIdRef = useRef<string | null>(null);
  const setFocusAvatar = useCallback((id: string | null) => {
    focusAvatarIdRef.current = id;
    setFocusAvatarId(id);
  }, []);
  const [audienceReplyBubble, setAudienceReplyBubble] = useState<{
    speakerLabel: string;
    text: string;
    isSpeaking: boolean;
  } | null>(null);

  // Webcam PiP (only shown if mediaStream actually includes a live video track)
  const hasVideoTrack = Boolean(
    mediaStream &&
      mediaStream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live')
  );
  const [showWebcam, setShowWebcam] = useState<boolean>(hasVideoTrack);
  const [isCameraMirrored, setIsCameraMirrored] = useState<boolean>(
    config.isCameraMirrored ?? true
  );
  const [webcamWidth, setWebcamWidth] = useState<number>(DEFAULT_WEBCAM_WIDTH);
  const webcamResizeRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const clampWebcamWidth = useCallback((targetWidth: number) => {
    const viewportCap =
      typeof window !== 'undefined'
        ? Math.max(MIN_WEBCAM_WIDTH, window.innerWidth - 32)
        : MAX_WEBCAM_WIDTH;
    const effectiveMax = Math.min(MAX_WEBCAM_WIDTH, viewportCap);
    return Math.round(
      Math.max(MIN_WEBCAM_WIDTH, Math.min(effectiveMax, targetWidth))
    );
  }, []);

  const handleWebcamResizePointerDown = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    webcamResizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: webcamWidth,
    };
  };

  const handleWebcamResizePointerMove = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!webcamResizeRef.current) return;
    e.preventDefault();
    const { startX, startY, startWidth } = webcamResizeRef.current;
    // Box is anchored at top-right: dragging left (startX - clientX > 0) or down (clientY - startY > 0) enlarges it
    const deltaX = startX - e.clientX;
    const deltaY = (e.clientY - startY) * (16 / 9);
    const delta = Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY;
    setWebcamWidth(clampWebcamWidth(startWidth + delta));
  };

  const handleWebcamResizePointerUp = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!webcamResizeRef.current) return;
    webcamResizeRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const isAvatarAnsweringRef = useRef<boolean>(false);
  const activeAnswerLockIdRef = useRef<number>(0);
  const answerLockWatchdogRef = useRef<any>(null);
  const answerUnlockTimerRef = useRef<any>(null);

  // Oscilloscope Canvas Ref
  const oscilloscopeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isSpeakingRef = useRef<boolean>(false);
  isSpeakingRef.current = isCurrentlySpeaking;

  // Speech & Audio Recorder Refs
  const recognizerRef = useRef<PresentationSpeechRecognizer | null>(null);
  const recorderRef = useRef<AudioSentenceRecorder | null>(null);
  const lastFastPathGreetingTimeRef = useRef<number>(0);
  const firedGreetingRepliesRef = useRef<Set<string>>(new Set());
  const recentInquiryRef = useRef<{ text: string; time: number } | null>(null);
  const pendingCalloutAvatarRef = useRef<{
    avatar: AudienceMember;
    time: number;
    priorStatement?: string;
  } | null>(null);
  const postCalloutWaitTimerRef = useRef<any>(null);
  const nominationWaitTimerRef = useRef<any>(null);
  const nominationSilenceUntilRef = useRef<number>(0);
  const activeThinkingBridgeRef = useRef<{
    waitForBridgeSlot: () => Promise<void>;
    cancelBridge: () => void;
  } | null>(null);
  const lastProcessedSentenceRef = useRef<{ text: string; time: number }>({ text: '', time: 0 });
  const lastSpeechActivityTimeRef = useRef<number>(Date.now());
  const lastApplauseTimeRef = useRef<number>(0);
  const hasDetectedPresentationEndRef = useRef<boolean>(false);
  const hasFinishedPresentationRef = useRef<boolean>(false);
  const preparedQAQuestionsRef = useRef<QuestionItem[]>([]);
  const qaGenerationPromiseRef = useRef<Promise<QuestionItem[]> | null>(null);
  const handRaiseLockUntilRef = useRef<number>(0);
  const handRaiseResetTimerRef = useRef<any>(null);
  const isHesitatingHandRef = useRef<boolean>(false);
  const lastHandRaiseHesitationStartRef = useRef<number>(0);
  const handRaiseHistoryRef = useRef<HandRaiseHistoryEntry[]>([]);

  // Acquire exclusive lock when an avatar begins answering a question so any duplicate/subsequent speech requests are blocked
  const acquireAvatarAnswerLock = useCallback((): number | null => {
    if (isAvatarAnsweringRef.current) {
      return null;
    }
    isAvatarAnsweringRef.current = true;
    const lockId = ++activeAnswerLockIdRef.current;

    if (nominationWaitTimerRef.current) {
      clearTimeout(nominationWaitTimerRef.current);
      nominationWaitTimerRef.current = null;
    }
    if (postCalloutWaitTimerRef.current) {
      clearTimeout(postCalloutWaitTimerRef.current);
      postCalloutWaitTimerRef.current = null;
    }
    if (answerUnlockTimerRef.current) {
      clearTimeout(answerUnlockTimerRef.current);
      answerUnlockTimerRef.current = null;
    }
    if (answerLockWatchdogRef.current) {
      clearTimeout(answerLockWatchdogRef.current);
      answerLockWatchdogRef.current = null;
    }

    recognizerRef.current?.clearBuffer();

    answerLockWatchdogRef.current = setTimeout(() => {
      if (activeAnswerLockIdRef.current === lockId) {
        isAvatarAnsweringRef.current = false;
      }
    }, 25000);

    return lockId;
  }, []);

  const releaseAvatarAnswerLock = useCallback(
    (lockId: number, delayMs = 600) => {
      if (activeAnswerLockIdRef.current !== lockId) return;
      if (answerLockWatchdogRef.current) {
        clearTimeout(answerLockWatchdogRef.current);
        answerLockWatchdogRef.current = null;
      }
      if (answerUnlockTimerRef.current) {
        clearTimeout(answerUnlockTimerRef.current);
        answerUnlockTimerRef.current = null;
      }
      recognizerRef.current?.clearBuffer();
      if (delayMs <= 0) {
        isAvatarAnsweringRef.current = false;
        return;
      }
      answerUnlockTimerRef.current = setTimeout(() => {
        answerUnlockTimerRef.current = null;
        if (activeAnswerLockIdRef.current === lockId) {
          recognizerRef.current?.clearBuffer();
          isAvatarAnsweringRef.current = false;
        }
      }, delayMs);
    },
    []
  );

  // Timer countdown / countup loop
  useEffect(() => {
    if (isPaused) return;

    const timer = setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [isPaused]);

  // Pre-warm core greetings and callout responses in the background for 0ms latency
  useEffect(() => {
    warmupAudienceVoices(config.audience);
  }, [config.audience]);

  // Connect webcam to PiP video element (do not lock audio track with MediaRecorder so Android SpeechRecognition works)
  useEffect(() => {
    const isAndroid =
      typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
    if (isAndroid && mediaStream) {
      mediaStream.getAudioTracks().forEach((t) => {
        t.stop();
        mediaStream.removeTrack(t);
      });
    }

    if (videoRef.current && mediaStream && mediaStream.getVideoTracks().length > 0) {
      videoRef.current.srcObject = mediaStream;
      videoRef.current.play().catch(() => {});
    }
  }, [mediaStream, showWebcam]);

  // Real-time Web Audio API Oscilloscope Waveform Animation
  useEffect(() => {
    const canvas = oscilloscopeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let dataArray: Uint8Array<ArrayBuffer> | null = null;

    const isAndroid =
      typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

    if (!isAndroid && mediaStream && mediaStream.getAudioTracks().length > 0) {
      try {
        const AudioContextClass =
          window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new AudioContextClass();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.82;
        sourceNode = audioCtx.createMediaStreamSource(mediaStream);
        sourceNode.connect(analyser);
        dataArray = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      } catch {
        // Fallback to synthetic speech-driven oscilloscope if AudioContext fails
      }
    }

    let animId = 0;
    let phase = 0;

    const renderWave = () => {
      animId = requestAnimationFrame(renderWave);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }

      const w = canvas.width;
      const h = canvas.height;
      const midY = h / 2;

      ctx.clearRect(0, 0, w, h);

      // Subtle center reference line
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.45)';
      ctx.lineWidth = 1 * dpr;
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();

      let maxDeviation = 0;
      if (analyser && dataArray) {
        analyser.getByteTimeDomainData(dataArray);
        for (let i = 0; i < dataArray.length; i++) {
          const dev = Math.abs(dataArray[i] - 128);
          if (dev > maxDeviation) maxDeviation = dev;
        }
      }

      const activeVoice = isSpeakingRef.current || maxDeviation > 6;
      phase += activeVoice ? 0.16 : 0.04;

      // Secondary subtle harmonic glow wave
      ctx.beginPath();
      ctx.strokeStyle = activeVoice
        ? 'rgba(52, 211, 153, 0.32)'
        : 'rgba(56, 189, 248, 0.18)';
      ctx.lineWidth = 2 * dpr;

      const sliceCount = 128;
      for (let i = 0; i <= sliceCount; i++) {
        const t = i / sliceCount;
        const x = t * w;
        const envelope = Math.sin(t * Math.PI);
        let yOffset = 0;
        if (analyser && dataArray && maxDeviation > 3) {
          const sampleIdx = Math.min(
            dataArray.length - 1,
            Math.floor(t * dataArray.length)
          );
          const norm = (dataArray[sampleIdx] - 128) / 128;
          yOffset = norm * h * 0.65 * envelope;
        } else if (activeVoice) {
          yOffset =
            (Math.sin(t * 18 - phase * 1.4) * 0.55 +
              Math.sin(t * 31 + phase * 0.9) * 0.35) *
            (h * 0.34) *
            envelope;
        } else {
          yOffset = Math.sin(t * 10 - phase) * (h * 0.07) * envelope;
        }
        const y = midY + yOffset * 0.7;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Primary crisp oscilloscope trace
      ctx.beginPath();
      ctx.strokeStyle = activeVoice ? '#34d399' : '#38bdf8';
      ctx.lineWidth = (activeVoice ? 2.4 : 1.6) * dpr;
      ctx.shadowColor = activeVoice
        ? 'rgba(52, 211, 153, 0.75)'
        : 'rgba(56, 189, 248, 0.4)';
      ctx.shadowBlur = activeVoice ? 10 * dpr : 4 * dpr;

      for (let i = 0; i <= sliceCount; i++) {
        const t = i / sliceCount;
        const x = t * w;
        const envelope = Math.sin(t * Math.PI);
        let yOffset = 0;
        if (analyser && dataArray && maxDeviation > 3) {
          const sampleIdx = Math.min(
            dataArray.length - 1,
            Math.floor(t * dataArray.length)
          );
          const norm = (dataArray[sampleIdx] - 128) / 128;
          yOffset = norm * h * 0.95 * envelope;
        } else if (activeVoice) {
          yOffset =
            (Math.sin(t * 24 - phase * 1.8) * 0.6 +
              Math.cos(t * 41 + phase * 1.3) * 0.4) *
            (h * 0.38) *
            envelope;
        } else {
          yOffset = Math.sin(t * 12 - phase * 0.8) * (h * 0.09) * envelope;
        }
        const y = midY + yOffset;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    renderWave();

    return () => {
      cancelAnimationFrame(animId);
      try {
        sourceNode?.disconnect();
        analyser?.disconnect();
        if (audioCtx && audioCtx.state !== 'closed') {
          audioCtx.close().catch(() => {});
        }
      } catch {}
    };
  }, [mediaStream]);

  // Handle Automatic End Detection Countdown
  useEffect(() => {
    if (!endNotification.show) return;

    if (endNotification.countdown <= 0) {
      handleFinishPresentation();
      return;
    }

    const interval = setInterval(() => {
      setEndNotification((prev) => ({
        ...prev,
        countdown: prev.countdown - 1,
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, [endNotification.show, endNotification.countdown]);

  // State refs to keep callbacks stable and prevent SpeechRecognizer unmounting
  const audienceRef = useRef<AudienceMember[]>(audience);
  const elapsedSecRef = useRef<number>(elapsedSec);
  const totalDurationSecRef = useRef<number>(totalDurationSec);
  const transcriptLogRef = useRef<TranscriptPoint[]>(transcriptLog);
  const endNotificationRef = useRef<{ show: boolean; countdown: number }>(endNotification);

  useEffect(() => {
    audienceRef.current = audience;
  }, [audience]);

  useEffect(() => {
    elapsedSecRef.current = elapsedSec;
  }, [elapsedSec]);

  useEffect(() => {
    totalDurationSecRef.current = totalDurationSec;
  }, [totalDurationSec]);

  useEffect(() => {
    transcriptLogRef.current = transcriptLog;
  }, [transcriptLog]);

  useEffect(() => {
    endNotificationRef.current = endNotification;
  }, [endNotification]);

  // Random realistic audience sneeze / cough timer with row-based distance attenuation (Request #1)
  useEffect(() => {
    let sneezeTimer: any = null;

    const getRowCountLayout = (total: number): number[] => {
      if (total <= 3) return [total];
      if (total <= 6) {
        const f = Math.ceil(total / 2);
        return [f, total - f];
      }
      if (total <= 30) {
        const rows: number[] = [];
        let rem = total;
        while (rem > 0) {
          rows.push(Math.min(6, rem));
          rem -= Math.min(6, rem);
        }
        return rows;
      }
      const rows: number[] = [Math.min(6, total)];
      let rem = total - rows[0];
      const maxPerBack = total <= 60 ? 10 : 12;
      while (rem > 0) {
        rows.push(Math.min(maxPerBack, rem));
        rem -= Math.min(maxPerBack, rem);
      }
      return rows;
    };

    const scheduleNextSneeze = () => {
      // Trigger randomly every 52 to 92 seconds (half the previous frequency)
      const delayMs = 52000 + Math.floor(Math.random() * 40000);
      sneezeTimer = setTimeout(() => {
        const currentAudience = audienceRef.current;
        const totalPeople = Math.max(
          currentAudience.length,
          config.totalAudienceCount || currentAudience.length
        );
        const rows = getRowCountLayout(totalPeople);
        const totalRows = rows.length;

        if (
          currentAudience.length > 0 &&
          !endNotificationRef.current.show &&
          Date.now() >= handRaiseLockUntilRef.current
        ) {
          // Decide whether an interactive member (row 0 or 1) or a back-row attendee sneezes
          const useBackRow =
            totalPeople > currentAudience.length && Math.random() < 0.52;

          if (useBackRow && totalRows >= 2) {
            const backRowIndex =
              1 + Math.floor(Math.random() * (totalRows - 1));
            const bgIndex = Math.floor(Math.random() * totalPeople);
            const randomGender: 'male' | 'female' =
              bgIndex % 2 === 0 ? 'male' : 'female';
            const panX = (Math.random() - 0.5) * 1.4;

            playSneezeOrCoughSound('sneeze', randomGender, {
              rowIndex: backRowIndex,
              totalRows,
              panX,
            });

            setSneezeTrigger({
              row: backRowIndex,
              bgIndex,
              timestamp: Date.now(),
            });
          } else {
            const candidates = currentAudience.filter(
              (a) => a.currentAction === 'idle' || a.currentAction === 'nod'
            );
            if (candidates.length > 0) {
              const target =
                candidates[Math.floor(Math.random() * candidates.length)];
              const memberIdx = currentAudience.findIndex(
                (a) => a.id === target.id
              );
              const frontRowCols = rows[0] || currentAudience.length;
              const targetRow = memberIdx >= frontRowCols ? 1 : 0;
              const colInRow =
                targetRow === 0 ? memberIdx : memberIdx - frontRowCols;
              const colsInThisRow = rows[targetRow] || 1;
              const panX =
                colsInThisRow > 1
                  ? ((colInRow / (colsInThisRow - 1)) * 2 - 1) * 0.65
                  : 0;

              playSneezeOrCoughSound('sneeze', target.gender, {
                rowIndex: targetRow,
                totalRows,
                panX,
              });

              setSneezeTrigger({
                avatarId: target.id,
                row: targetRow,
                timestamp: Date.now(),
              });

              setAudience((prev) =>
                prev.map((a) =>
                  a.id === target.id ? { ...a, currentAction: 'sneeze' } : a
                )
              );

              setTimeout(() => {
                setAudience((prev) =>
                  prev.map((a) =>
                    a.id === target.id && a.currentAction === 'sneeze'
                      ? { ...a, currentAction: 'idle' }
                      : a
                  )
                );
              }, 1300);
            }
          }
        }
        scheduleNextSneeze();
      }, delayMs);
    };

    scheduleNextSneeze();
    return () => {
      if (sneezeTimer) clearTimeout(sneezeTimer);
    };
  }, [config.totalAudienceCount]);

  // Note: Time-based silence sleep triggers have been removed as requested.
  // Avatar sleep action ('sleep') is now strictly driven by LLM content evaluation when presentation material is uninteresting.

  // Helper to trigger applause audio + animation (Point #4)
  const triggerApplauseEffect = useCallback(() => {
    const now = Date.now();
    if (now - lastApplauseTimeRef.current < 10000) return;
    lastApplauseTimeRef.current = now;
    playApplauseSound(config.totalAudienceCount, 3400);
  }, [config.totalAudienceCount]);

  // Phase 1 of Hand-Raise: Japanese-style looking around ('キョロキョロ') + tentative hand movement + "アバターが思考中…" toast
  const startHandRaiseHesitation = useCallback(() => {
    if (handRaiseResetTimerRef.current) {
      clearTimeout(handRaiseResetTimerRef.current);
      handRaiseResetTimerRef.current = null;
    }
    isHesitatingHandRef.current = true;
    lastHandRaiseHesitationStartRef.current = Date.now();
    handRaiseLockUntilRef.current = Date.now() + 8000;
    setSleepingRatio(0);
    setRaisedHandRatio(0);
    setThinkingState({
      isThinking: true,
      text: 'アバターが思考中…',
    });
    setAudience((prev) =>
      prev.map((a) => ({
        ...a,
        currentAction: 'hesitate_hand',
      }))
    );
  }, []);

  // Phase 2 of Hand-Raise: Apply LLM-decided hand raising for matched avatars and reset non-matched avatars to idle
  const triggerRealisticHandRaise = useCallback(
    (
      raisedIds: Set<string>,
      ratio: number,
      durationMs = 5500,
      topicKey = '',
      isNegative = false
    ) => {
      isHesitatingHandRef.current = false;
      handRaiseLockUntilRef.current = Date.now() + durationMs;
      setHandRaiseTopicKey(topicKey);
      setIsNegativeHandRaise(isNegative);
      setRaisedHandRatio(ratio);
      setSleepingRatio(0);

      setAudience((prev) =>
        prev.map((a) => ({
          ...a,
          currentAction: raisedIds.has(a.id) ? 'raised_hand' : 'idle',
        }))
      );

      if (handRaiseResetTimerRef.current) {
        clearTimeout(handRaiseResetTimerRef.current);
      }

      handRaiseResetTimerRef.current = setTimeout(() => {
        handRaiseLockUntilRef.current = 0;
        setRaisedHandRatio(0);
        setAudience((prev) =>
          prev.map((a) =>
            a.currentAction === 'raised_hand' || a.currentAction === 'hesitate_hand'
              ? { ...a, currentAction: 'idle' }
              : a
          )
        );
      }, durationMs);
    },
    []
  );

  // Fast-Path: 挨拶（おはようございます・こんにちは・よろしくお願いします）を瞬時に斉唱返答
  const handleFastPathGreeting = useCallback(
    (fastGreeting: FastPathGreetingResult) => {
      if (isAvatarAnsweringRef.current) return;
      setFocusAvatar(null);
      setSleepingRatio(0);

      setAudience((prev) =>
        prev.map((a) => ({ ...a, currentAction: 'nod' }))
      );

      setTimeout(() => {
        setAudience((prev) =>
          prev.map((a) =>
            a.currentAction === 'nod' ? { ...a, currentAction: 'idle' } : a
          )
        );
      }, 2000);

      setAudienceReplyBubble({
        speakerLabel: '聴衆一同',
        text: fastGreeting.replyText,
        isSpeaking: true,
      });

      speakChorus(
        fastGreeting.replyText,
        () => {},
        () => {
          setAudienceReplyBubble((prev) =>
            prev ? { ...prev, isSpeaking: false } : null
          );
          setTimeout(() => {
            setAudienceReplyBubble(null);
          }, 1800);
        }
      );
    },
    []
  );

  // 発表終了時（is_presentation_end 検知時）の1回のみ、全文脈から質疑応答（Q&A）の質問を生成
  const generateEndOfPresentationQAQuestions = useCallback(
    (currentLog: TranscriptPoint[]): Promise<QuestionItem[]> => {
      if (qaGenerationPromiseRef.current) {
        return qaGenerationPromiseRef.current;
      }
      if (currentLog.length < 2) {
        return Promise.resolve([]);
      }

      const promise = (async () => {
        try {
          const res = await fetch('/api/presentation/generate-qa-questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transcriptHistory: currentLog,
              audience: audienceRef.current,
            }),
          });
          const data = await res.json();
          if (Array.isArray(data.questions)) {
            const generatedItems: QuestionItem[] = data.questions.map(
              (q: any, idx: number) => ({
                id: `qa-gen-${Date.now()}-${idx}`,
                avatarId:
                  q.avatarId ||
                  audienceRef.current[idx % audienceRef.current.length]?.id ||
                  'avatar-1',
                avatarName:
                  q.avatarName ||
                  audienceRef.current[idx % audienceRef.current.length]?.name ||
                  '聴衆',
                role: (q.role ||
                  audienceRef.current[idx % audienceRef.current.length]?.role ||
                  'professor') as any,
                questionText: q.questionText,
                isResolved: false,
              })
            );
            preparedQAQuestionsRef.current = generatedItems;
            // Preload TTS audio for all generated Q&A questions sequentially in the background for 0ms transition delay
            (async () => {
              for (const item of generatedItems) {
                if (!item.questionText) continue;
                const targetMember =
                  audienceRef.current.find((a) => a.id === item.avatarId) ||
                  audienceRef.current[0];
                if (targetMember) {
                  await preloadTtsAudio(
                    item.questionText,
                    targetMember.role,
                    targetMember.gender,
                    targetMember.voiceName,
                    false
                  );
                }
              }
            })();
            return generatedItems;
          }
          return [];
        } catch (err) {
          console.warn('End-of-presentation QA generation notice:', err);
          return [];
        } finally {
          qaGenerationPromiseRef.current = null;
        }
      })();

      qaGenerationPromiseRef.current = promise;
      return promise;
    },
    []
  );

  // 指名後に3秒間質問がなかった場合、直前の発表内容について回答を生成・発話する処理
  const executeAnswerToPriorContent = useCallback(
    (target: AudienceMember, priorStatementFromCallout?: string) => {
      const lockId = acquireAvatarAnswerLock();
      if (lockId === null) {
        return;
      }
      pendingCalloutAvatarRef.current = null;

      setThinkingState({
        isThinking: true,
        text: '直前の発表内容について回答中…',
        avatarName: target.name,
      });

      setAudience((prev) =>
        prev.map((a) =>
          a.id === target.id ? { ...a, currentAction: 'nod' } : a
        )
      );

      const priorStatementToUse =
        priorStatementFromCallout ||
        transcriptLogRef.current.map((t) => t.text).slice(-2).join(' ') ||
        '直前の発表内容';

      if (activeThinkingBridgeRef.current) {
        activeThinkingBridgeRef.current.cancelBridge();
        activeThinkingBridgeRef.current = null;
      }
      const bridge = runThinkingBridgeSequence({
        role: target.role,
        gender: target.gender,
        voiceName: target.voiceName,
        avatarId: target.id,
        stage1Category: 'thinking_stage1',
        stage2Category: 'thinking_stage2',
        onUpdateBubble: (fillerText) => {
          if (activeAnswerLockIdRef.current !== lockId) return;
          setAudienceReplyBubble({
            speakerLabel: target.name,
            text: fillerText,
            isSpeaking: true,
          });
        },
      });
      activeThinkingBridgeRef.current = bridge;

      const latestTarget =
        audienceRef.current.find((a) => a.id === target.id) || target;

      fetch('/api/presentation/audience-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentUtterance: priorStatementToUse,
          immediatePriorUtterance: priorStatementToUse,
          presentationTranscript: transcriptLogRef.current
            .map((t) => t.text)
            .join(' '),
          targetAvatar: {
            id: latestTarget.id,
            name: latestTarget.name,
            role: latestTarget.role,
            roleLabel: latestTarget.roleLabel,
            gender: latestTarget.gender,
            profile: latestTarget.profile || '',
            learnedTraits: latestTarget.learnedTraits || [],
          },
          handRaiseHistory: handRaiseHistoryRef.current,
          isFollowUpToCallout: true,
          respondToPriorContent: true,
        }),
      })
        .then((r) => r.json())
        .then(async (ansData) => {
          if (activeAnswerLockIdRef.current !== lockId) return;
          if (ansData?.isSpendCapError) {
            setSpendCapWarning(
              '⚠️ Google Cloud側でGemini APIの支出上限（Spend Cap）に達しているため、LLM呼び出しが制限されています (Project: 544573709225)。AI StudioまたはGoogle Cloudコンソールで支出上限を引き上げてください。'
            );
          }
          const reply =
            (ansData?.replyText || '').trim() ||
            createClientDynamicFallback(
              priorStatementToUse,
              latestTarget.role,
              latestTarget.name,
              latestTarget,
              handRaiseHistoryRef.current
            );
          const addedTrait =
            (ansData?.newTrait || '').trim() ||
            `「${priorStatementToUse}」に対して「${reply}」と回答した`;

          await preloadTtsAudio(
            reply,
            latestTarget.role,
            latestTarget.gender,
            latestTarget.voiceName
          );

          await bridge.waitForBridgeSlot();
          if (activeAnswerLockIdRef.current !== lockId) return;
          setThinkingState(null);

          setAudience((prev) => {
            const next = prev.map((a) =>
              a.id === latestTarget.id
                ? {
                    ...a,
                    currentAction: (ansData?.action || 'nod') as any,
                    learnedTraits: Array.from(
                      new Set([...(a.learnedTraits || []), addedTrait])
                    ),
                  }
                : a
            );
            audienceRef.current = next;
            return next;
          });

          setAudienceReplyBubble({
            speakerLabel: target.name,
            text: reply,
            isSpeaking: true,
          });

          // Record interactive dialogue in transcriptLog so report never treats dialogue time as silence/stagnation
          const dialoguePoint: TranscriptPoint = {
            time: elapsedSecRef.current,
            text: `【${target.name}との双方向対話】${priorStatementToUse}`,
            interest: 88,
            understanding: 85,
            emotion: 'Impressed',
            action: 'nod',
            avatarId: target.id,
            comment: `${target.name}の回答: 「${reply}」`,
          };
          setTranscriptLog((prev) => {
            const next = [...prev, dialoguePoint];
            transcriptLogRef.current = next;
            return next;
          });

          speakText(
            reply,
            target.role,
            target.gender,
            () => {
              isAvatarAnsweringRef.current = true;
            },
            () => {
              releaseAvatarAnswerLock(lockId, 600);
              setAudienceReplyBubble((prev) =>
                prev ? { ...prev, isSpeaking: false } : null
              );
              pendingCalloutAvatarRef.current = null;
              setTimeout(() => {
                if (!isAvatarAnsweringRef.current) {
                  setFocusAvatar(null);
                  setAudienceReplyBubble(null);
                }
              }, 1200);
            },
            {
              voiceName: target.voiceName,
              avatarId: target.id,
              isProtected: true,
              isMainAnswer: true,
            }
          );
        })
        .catch((err) => {
          console.error('Error in audience answer:', err);
          if (activeAnswerLockIdRef.current !== lockId) return;
          const fallbackReply = createClientDynamicFallback(
            priorStatementToUse,
            target.role,
            target.name
          );

          preloadTtsAudio(
            fallbackReply,
            target.role,
            target.gender,
            target.voiceName
          ).then(async () => {
            await bridge.waitForBridgeSlot();
            if (activeAnswerLockIdRef.current !== lockId) return;
            setThinkingState(null);

            setAudienceReplyBubble({
              speakerLabel: target.name,
              text: fallbackReply,
              isSpeaking: true,
            });

            speakText(
              fallbackReply,
              target.role,
              target.gender,
              () => {
                isAvatarAnsweringRef.current = true;
              },
              () => {
                releaseAvatarAnswerLock(lockId, 600);
                setAudienceReplyBubble((prev) =>
                  prev ? { ...prev, isSpeaking: false } : null
                );
                pendingCalloutAvatarRef.current = null;
                setTimeout(() => {
                  if (!isAvatarAnsweringRef.current) {
                    setFocusAvatar(null);
                    setAudienceReplyBubble(null);
                  }
                }, 1200);
              },
              {
                voiceName: target.voiceName,
                avatarId: target.id,
                isProtected: true,
                isMainAnswer: true,
              }
            );
          });
        });
    },
    [acquireAvatarAnswerLock, releaseAvatarAnswerLock]
  );

  // Gemini Presentation Analysis: バックグラウンド内部処理で文脈解析・ダイナミック採点・論理的受け答え・リアルな挙手判定を実行
  const handleFinalSentence = useCallback(
    async (tentativeSentence: string) => {
      const cleanInput = tentativeSentence.trim();
      if (!cleanInput) return;

      // 発表終了フレーズ（「これで終わります」「ご清聴ありがとうございました」等）の即時検知
      if (isPresentationEndPhrase(cleanInput)) {
        activeAnswerLockIdRef.current++;
        isAvatarAnsweringRef.current = false;
        if (answerLockWatchdogRef.current) {
          clearTimeout(answerLockWatchdogRef.current);
          answerLockWatchdogRef.current = null;
        }
        if (answerUnlockTimerRef.current) {
          clearTimeout(answerUnlockTimerRef.current);
          answerUnlockTimerRef.current = null;
        }
        if (nominationWaitTimerRef.current) {
          clearTimeout(nominationWaitTimerRef.current);
          nominationWaitTimerRef.current = null;
        }
        if (activeThinkingBridgeRef.current) {
          activeThinkingBridgeRef.current.cancelBridge();
          activeThinkingBridgeRef.current = null;
        }
        cancelActiveSpeech(true, true);
        pendingCalloutAvatarRef.current = null;
        setFocusAvatar(null);
        setThinkingState(null);
        setAudienceReplyBubble(null);
        setSleepingRatio(0);
        setAudienceMood('normal');

        const currentSec = elapsedSecRef.current;
        const currentAudience = audienceRef.current;
        const isFirstEnd = !hasDetectedPresentationEndRef.current;
        if (isFirstEnd) {
          hasDetectedPresentationEndRef.current = true;
          endNotificationRef.current = { show: true, countdown: 4 };
          setEndNotification({ show: true, countdown: 4 });
          triggerApplauseEffect();
        }

        setAudience((prev) =>
          prev.map((a) => ({
            ...a,
            currentAction: 'clap',
            emotion: 'Impressed',
          }))
        );

        const endPoint: TranscriptPoint = {
          time: currentSec,
          text: cleanInput,
          interest: 88,
          understanding: 86,
          emotion: 'Impressed',
          action: 'clap',
          avatarId: currentAudience[0]?.id || 'avatar-1',
          comment: '発表の締めくくりに拍手が送られています',
        };

        setTranscriptLog((prev) => {
          const lastItem = prev[prev.length - 1];
          if (lastItem && isNearDuplicateSentence(lastItem.text, endPoint.text)) {
            if (isFirstEnd) {
              generateEndOfPresentationQAQuestions(prev);
            }
            return prev;
          }
          const next = [...prev, endPoint];
          transcriptLogRef.current = next;
          if (isFirstEnd) {
            generateEndOfPresentationQAQuestions(next);
          }
          return next;
        });

        setIsCurrentlySpeaking(false);
        setIsAnalyzing(false);
        return;
      }

      // アバターが質問に対して回答中（回答生成〜音声発話完了まで）は、次の発話リクエストが来ても完全にブロックする
      if (isAvatarAnsweringRef.current) {
        setIsCurrentlySpeaking(false);
        setIsAnalyzing(false);
        return;
      }

      const now = Date.now();
      lastSpeechActivityTimeRef.current = now;

      // Cancel any pending "react to prior content after timeout" timer because presenter just spoke!
      if (postCalloutWaitTimerRef.current) {
        clearTimeout(postCalloutWaitTimerRef.current);
        postCalloutWaitTimerRef.current = null;
      }

      // Prevent duplicate or near-duplicate sentence processing (Point #2)
      if (
        (cleanInput === lastProcessedSentenceRef.current.text ||
          isNearDuplicateSentence(cleanInput, lastProcessedSentenceRef.current.text)) &&
        now - lastProcessedSentenceRef.current.time < 9000
      ) {
        return;
      }
      const prevLogged = transcriptLogRef.current[transcriptLogRef.current.length - 1];
      if (prevLogged && isNearDuplicateSentence(cleanInput, prevLogged.text)) {
        return;
      }

      lastProcessedSentenceRef.current = { text: cleanInput, time: now };

      setIsCurrentlySpeaking(false);
      setIsAnalyzing(true);
      setRecognizedCount((prev) => prev + 1);

      const currentSec = elapsedSecRef.current;
      const currentAudience = audienceRef.current;
      const remainingSec = Math.max(0, totalDurationSecRef.current - currentSec);

      // クライアント側で指名されたアバターを検出（名字・愛称・役職対応）
      const directTarget = currentAudience.find((a) => {
        const family = a.name.replace(/[\s(（].*$/, '').trim();
        return (
          cleanInput.includes(family) ||
          (family.length >= 2 && cleanInput.includes(family.slice(0, 2))) ||
          (a.role === 'professor' && /(教授|先生)/.test(cleanInput))
        );
      });

      // 直前に指名されて待機中のアバター (有効期間90秒)
      const pendingCallout =
        pendingCalloutAvatarRef.current &&
        Date.now() - pendingCalloutAvatarRef.current.time < 90000
          ? pendingCalloutAvatarRef.current.avatar
          : null;

      // 名前を呼ぶ直前の1文（18秒以内の直前発言）
      const rawPriorUtterance =
        recentInquiryRef.current &&
        Date.now() - recentInquiryRef.current.time < 18000
          ? recentInquiryRef.current.text
          : '';

      const activeCalloutTarget =
        directTarget ||
        pendingCallout ||
        (focusAvatarIdRef.current
          ? currentAudience.find((a) => a.id === focusAvatarIdRef.current)
          : null);

      const isFollowUpToCallout = Boolean(
        pendingCallout &&
        (!directTarget || directTarget.id === pendingCallout.id)
      );

      // 挙手リクエストの即時プレビュー判定（「手を挙げて」「挙手」等の明示ワードが含まれる場合）
      const isExplicitHandRaiseCue =
        /(手を挙げ|手をあげ|手を上げ|てをあげ|挙手|手をお挙げ|手をおあげ)/.test(
          cleanInput
        );

      if (activeCalloutTarget && !isExplicitHandRaiseCue) {
        const target = activeCalloutTarget;
        const nominationCheck = checkNominationCallout(cleanInput, target.name);

        if (activeThinkingBridgeRef.current) {
          activeThinkingBridgeRef.current.cancelBridge();
          activeThinkingBridgeRef.current = null;
        }
        if (!isAvatarAnsweringRef.current) {
          cancelActiveSpeech(false);
        }
        recentInquiryRef.current = null;
        setSleepingRatio(0);

        setFocusAvatar(target.id);
        setAudience((prev) =>
          prev.map((a) =>
            a.id === target.id ? { ...a, currentAction: 'nod' } : a
          )
        );

        const presentationTranscript = transcriptLogRef.current
          .map((t) => t.text)
          .join(' ');

        const isNewNomination = Boolean(
          directTarget && (!pendingCallout || pendingCallout.id !== directTarget.id)
        );

        // すでに指名されて待機中（isFollowUpToCallout）の場合、名前を繰り返しただけ（substantiveTextが空）でない限り、必ず質問・問いかけとして扱う
        const shouldWaitForQuestion = isFollowUpToCallout
          ? nominationCheck.isPureNomination &&
            !isExplicitQuestionUtterance(cleanInput)
          : nominationCheck.isPureNomination;

        // 純粋な指名時（「佐藤さん」等）は、指名されてから3秒間は相槌を含めて一切喋らず質問を待つ
        if (shouldWaitForQuestion) {
          nominationSilenceUntilRef.current = Date.now() + 3000;
          pendingCalloutAvatarRef.current = {
            avatar: target,
            time: Date.now(),
            priorStatement:
              nominationCheck.substantiveText ||
              rawPriorUtterance ||
              pendingCalloutAvatarRef.current?.priorStatement ||
              '',
          };

          if (nominationWaitTimerRef.current) {
            clearTimeout(nominationWaitTimerRef.current);
            nominationWaitTimerRef.current = null;
          }

          setThinkingState(null);
          setAudienceReplyBubble({
            speakerLabel: target.name,
            text: '（質問を待っています…）',
            isSpeaking: false,
          });

          // 3秒間無音だった場合のみ、「当てられる前に質問されていた」と判定して直前の内容について回答＆TTS待機相槌を開始
          nominationWaitTimerRef.current = setTimeout(() => {
            nominationWaitTimerRef.current = null;
            const currentPending = pendingCalloutAvatarRef.current;
            if (!currentPending || currentPending.avatar.id !== target.id) return;

            executeAnswerToPriorContent(target, currentPending.priorStatement);
          }, 3000);
        } else {
          // 発表者が具体的な質問を発話した場合: 即座に回答ロックを取得し、以降の重複発話・別質問リクエストをすべてブロックする
          const lockId = acquireAvatarAnswerLock();
          if (lockId === null) {
            setIsAnalyzing(false);
            return;
          }

          pendingCalloutAvatarRef.current = null;

          // すでに指名後に質問を言い終えた場合（isFollowUpToCallout）は即座に回答生成へ進み、
          // 1文で「佐藤さん、〇〇ですか？」と指名＋質問を同時に行った場合のみ500msの間を置く
          const waitBeforeSpeakingMs = isFollowUpToCallout ? 100 : 500;

          // Record presenter's question to the audience in transcriptLog immediately
          const questionLogPoint: TranscriptPoint = {
            time: currentSec,
            text: cleanInput,
            interest: 86,
            understanding: 84,
            emotion: 'Interested',
            action: 'nod',
            avatarId: target.id,
            comment: `${target.name}への問いかけ（双方向対話）`,
          };
          setTranscriptLog((prev) => {
            const lastItem = prev[prev.length - 1];
            if (lastItem && isNearDuplicateSentence(lastItem.text, questionLogPoint.text)) {
              return prev;
            }
            const next = [...prev, questionLogPoint];
            transcriptLogRef.current = next;
            return next;
          });

          setThinkingState({
            isThinking: true,
            text: `${target.name}が回答を考案中…`,
            avatarName: target.name,
          });

          setAudienceReplyBubble({
            speakerLabel: target.name,
            text: '考え中……',
            isSpeaking: false,
          });

          setAudience((prev) =>
            prev.map((a) =>
              a.id === target.id ? { ...a, currentAction: 'nod' } : a
            )
          );

          nominationWaitTimerRef.current = setTimeout(() => {
            nominationWaitTimerRef.current = null;
            if (activeAnswerLockIdRef.current !== lockId) return;

            // TTS生成を待つ時のみ相槌を再生するブリッジシーケンス
            const bridge = runThinkingBridgeSequence({
              role: target.role,
              gender: target.gender,
              voiceName: target.voiceName,
              avatarId: target.id,
              stage1Category: 'thinking_stage1',
              stage2Category: 'thinking_stage2',
              onUpdateBubble: (fillerText) => {
                if (activeAnswerLockIdRef.current !== lockId) return;
                setAudienceReplyBubble({
                  speakerLabel: target.name,
                  text: fillerText,
                  isSpeaking: true,
                });
              },
            });
            activeThinkingBridgeRef.current = bridge;

            const latestTarget =
              audienceRef.current.find((a) => a.id === target.id) || target;

            fetch('/api/presentation/audience-answer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                currentUtterance: cleanInput,
                immediatePriorUtterance: isFollowUpToCallout
                  ? ''
                  : rawPriorUtterance || '',
                presentationTranscript,
                targetAvatar: {
                  id: latestTarget.id,
                  name: latestTarget.name,
                  role: latestTarget.role,
                  roleLabel: latestTarget.roleLabel,
                  gender: latestTarget.gender,
                  profile: latestTarget.profile || '',
                  learnedTraits: latestTarget.learnedTraits || [],
                },
                handRaiseHistory: handRaiseHistoryRef.current,
                isFollowUpToCallout,
                respondToPriorContent: false,
              }),
            })
              .then((r) => r.json())
              .then(async (ansData) => {
                if (activeAnswerLockIdRef.current !== lockId) return;
                if (ansData?.isSpendCapError) {
                  setSpendCapWarning(
                    '⚠️ Google Cloud側でGemini APIの支出上限（Spend Cap）に達しているため、LLM呼び出しが制限されています (Project: 544573709225)。AI StudioまたはGoogle Cloudコンソールで支出上限を引き上げてください。'
                  );
                }
                const reply =
                  (ansData?.replyText || '').trim() ||
                  createClientDynamicFallback(
                    cleanInput,
                    latestTarget.role,
                    latestTarget.name,
                    latestTarget,
                    handRaiseHistoryRef.current
                  );
                const addedTrait =
                  (ansData?.newTrait || '').trim() ||
                  `「${cleanInput}」に対して「${reply}」と回答した`;

                await preloadTtsAudio(
                  reply,
                  latestTarget.role,
                  latestTarget.gender,
                  latestTarget.voiceName
                );

                await bridge.waitForBridgeSlot();
                if (activeAnswerLockIdRef.current !== lockId) return;
                setThinkingState(null);

                setAudience((prev) => {
                  const next = prev.map((a) =>
                    a.id === latestTarget.id
                      ? {
                          ...a,
                          currentAction: (ansData?.action || 'nod') as any,
                          learnedTraits: Array.from(
                            new Set([...(a.learnedTraits || []), addedTrait])
                          ),
                        }
                      : a
                  );
                  audienceRef.current = next;
                  return next;
                });

                setAudienceReplyBubble({
                  speakerLabel: latestTarget.name,
                  text: reply,
                  isSpeaking: true,
                });

                // Update transcriptLog with the audience member's reply timestamp so the dialogue duration is recorded as active interaction
                const answerLogPoint: TranscriptPoint = {
                  time: elapsedSecRef.current,
                  text: `【${latestTarget.name}の回答】「${reply}」`,
                  interest: 90,
                  understanding: 88,
                  emotion: 'Impressed',
                  action: 'nod',
                  avatarId: latestTarget.id,
                  comment: `オーディエンス（${latestTarget.name}）との双方向対話が成立`,
                };
                setTranscriptLog((prev) => {
                  const next = [...prev, answerLogPoint];
                  transcriptLogRef.current = next;
                  return next;
                });

                speakText(
                  reply,
                  latestTarget.role,
                  latestTarget.gender,
                  () => {
                    isAvatarAnsweringRef.current = true;
                  },
                  () => {
                    releaseAvatarAnswerLock(lockId, 600);
                    setAudienceReplyBubble((prev) =>
                      prev ? { ...prev, isSpeaking: false } : null
                    );
                    pendingCalloutAvatarRef.current = null;
                    setTimeout(() => {
                      if (!isAvatarAnsweringRef.current) {
                        setFocusAvatar(null);
                        setAudienceReplyBubble(null);
                      }
                    }, 1500);
                  },
                  {
                    voiceName: latestTarget.voiceName,
                    avatarId: latestTarget.id,
                    isProtected: true,
                    isMainAnswer: true,
                  }
                );
              })
              .catch((err) => {
                console.error('Error in audience answer:', err);
                if (activeAnswerLockIdRef.current !== lockId) return;
                const fallbackReply = createClientDynamicFallback(
                  cleanInput,
                  latestTarget.role,
                  latestTarget.name,
                  latestTarget,
                  handRaiseHistoryRef.current
                );

                preloadTtsAudio(
                  fallbackReply,
                  target.role,
                  target.gender,
                  target.voiceName
                ).then(async () => {
                  await bridge.waitForBridgeSlot();
                  if (activeAnswerLockIdRef.current !== lockId) return;
                  setThinkingState(null);

                  setAudienceReplyBubble({
                    speakerLabel: target.name,
                    text: fallbackReply,
                    isSpeaking: true,
                  });

                  speakText(
                    fallbackReply,
                    target.role,
                    target.gender,
                    () => {
                      isAvatarAnsweringRef.current = true;
                    },
                    () => {
                      releaseAvatarAnswerLock(lockId, 600);
                      setAudienceReplyBubble((prev) =>
                        prev ? { ...prev, isSpeaking: false } : null
                      );
                      pendingCalloutAvatarRef.current = null;
                      setTimeout(() => {
                        if (!isAvatarAnsweringRef.current) {
                          setFocusAvatar(null);
                          setAudienceReplyBubble(null);
                        }
                      }, 1500);
                    },
                    {
                      voiceName: target.voiceName,
                      avatarId: target.id,
                      isProtected: true,
                      isMainAnswer: true,
                    }
                  );
                });
              });
          }, waitBeforeSpeakingMs);
        }
        setIsAnalyzing(false);
        return;
      } else {
        recentInquiryRef.current = { text: cleanInput, time: Date.now() };

        if (isExplicitHandRaiseCue) {
          // Immediately start or maintain Japanese-style looking around ('hesitate_hand') + "アバターが思考中…" toast while LLM evaluates
          if (!isHesitatingHandRef.current) {
            startHandRaiseHesitation();
          } else {
            setThinkingState({
              isThinking: true,
              text: 'アバターが思考中…',
            });
          }
        } else {
          // Request #5: Match exact greeting ("こんにちは" -> "こんにちは！", "おはよう" -> "おはようございます！", etc.)
          // 一度すでに返答した挨拶（または直近で発火済みの挨拶）は絶対に2回発火させない
          const matchedGreetingReply = getMatchingGreetingReply(cleanInput);
          const alreadyFiredThisGreeting =
            matchedGreetingReply !== null &&
            firedGreetingRepliesRef.current.has(matchedGreetingReply);
          const wasFastPathRecentlyFired =
            Date.now() - lastFastPathGreetingTimeRef.current < 8000;

          if (
            matchedGreetingReply &&
            !alreadyFiredThisGreeting &&
            !wasFastPathRecentlyFired
          ) {
            firedGreetingRepliesRef.current.add(matchedGreetingReply);
            lastFastPathGreetingTimeRef.current = Date.now();
            setFocusAvatar(null);
            setSleepingRatio(0);
            setAudienceMood('normal');
            setAudience((prev) =>
              prev.map((a) => ({ ...a, currentAction: 'nod' }))
            );

            setAudienceReplyBubble({
              speakerLabel: '聴衆一同',
              text: matchedGreetingReply,
              isSpeaking: true,
            });

            speakChorus(
              matchedGreetingReply,
              () => {},
              () => {
                setAudienceReplyBubble((prev) =>
                  prev ? { ...prev, isSpeaking: false } : null
                );
                setTimeout(() => {
                  setAudienceReplyBubble(null);
                }, 2000);
              }
            );
          } else if (
            /(\?|？|ですか|でしょうか|ますか|ありませんか|ありますか|ですよね|よね)/.test(
              cleanInput
            ) &&
            Date.now() >= handRaiseLockUntilRef.current
          ) {
            setFocusAvatar(null);
            setSleepingRatio(0);
            setAudience((prev) =>
              prev.map((a) =>
                a.currentAction === 'raised_hand' || a.currentAction === 'hesitate_hand'
                  ? a
                  : { ...a, currentAction: 'nod' }
              )
            );
          }
        }
      }

      // Request #1: Immediately trigger note-taking ('important' mood) when the presenter speaks key points/conclusions/data
      const isImportantStatement =
        /(重要|大事な|ポイント|結論|結果|提案|手法|課題|目的|理由|なぜなら|したがって|つまり|まとめ|特徴|メリット|効果|データ|実験|発見|根拠|注目|核心|本質|解決|達成|向上|削減|[0-9０-９]+(%|％|倍|件|人|秒|分))/.test(
          cleanInput
        );
      if (isImportantStatement && !isExplicitHandRaiseCue) {
        setAudienceMood('important');
        setSleepingRatio(0);
      }

      const recentContext = transcriptLogRef.current.slice(-3).map((t) => t.text).join(' ');

      try {
        const res = await fetch('/api/presentation/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentSentence: cleanInput,
            recentContext,
            audience: currentAudience.map((a) => ({
              id: a.id,
              name: a.name,
              role: a.role,
              roleLabel: a.roleLabel,
              gender: a.gender,
              profile: a.profile || '',
              learnedTraits: a.learnedTraits || [],
            })),
            handRaiseHistory: handRaiseHistoryRef.current,
            elapsedSeconds: currentSec,
            remainingSeconds: remainingSec,
          }),
        });

        const data = await res.json();
        const reaction = data?.audience_reaction;

        if (reaction) {
          const interestVal =
            typeof reaction.interest_score === 'number'
              ? reaction.interest_score
              : 70;
          const understandingVal =
            typeof reaction.understanding_score === 'number'
              ? reaction.understanding_score
              : 70;

          // Request #1:
          // - 全くもって面白くない時 (very_bored): 寝る ('sleep')
          // - 少しだけ面白くなくなった時 (slightly_bored): 腕を組む・頭を触る・隣の人と話す
          // - 大事な話をしている時 (important): メモをする ('take_notes')
          const isVeryBored =
            reaction.action === 'sleep' ||
            reaction.emotion === 'Bored' ||
            interestVal < 52;

          const isSlightlyBored =
            !isVeryBored &&
            !isImportantStatement &&
            (interestVal < 65 ||
              understandingVal < 58 ||
              reaction.emotion === 'Confused');

          const isImportantContent =
            !isVeryBored &&
            !isSlightlyBored &&
            (isImportantStatement ||
              interestVal >= 75 ||
              understandingVal >= 78 ||
              reaction.emotion === 'Impressed');

          const isFirstPresentationEnd =
            Boolean(data.is_presentation_end) &&
            !hasDetectedPresentationEndRef.current;

          if (isFirstPresentationEnd) {
            hasDetectedPresentationEndRef.current = true;
            endNotificationRef.current = { show: true, countdown: 4 };
          }

          const isClapping =
            isFirstPresentationEnd ||
            (reaction.action === 'clap' &&
              !data.is_presentation_end &&
              !hasDetectedPresentationEndRef.current);

          if (isClapping) {
            triggerApplauseEffect();
            setAudienceMood('normal');
            setSleepingRatio(0);
          } else if (isVeryBored && !data.is_hand_raise_prompt) {
            setAudienceMood('very_bored');
            setSleepingRatio(0.85);
          } else if (isSlightlyBored && !data.is_hand_raise_prompt) {
            setAudienceMood('slightly_bored');
            setSleepingRatio(0);
          } else if (isImportantContent && !data.is_hand_raise_prompt) {
            setAudienceMood('important');
            setSleepingRatio(0);
          } else {
            setAudienceMood('normal');
            setSleepingRatio(0);
          }

          const sentenceActuallyAsksForHands =
            isExplicitHandRaiseCue ||
            /(いますか|いらっしゃいますか|どれくらい|経験ある方|経験がある方)/.test(
              cleanInput
            );

          if (data.is_hand_raise_prompt && sentenceActuallyAsksForHands) {
            // If hesitation hadn't started yet (e.g. implicit survey question without "手を挙げて"), start it briefly
            if (!isHesitatingHandRef.current && lastHandRaiseHesitationStartRef.current === 0) {
              startHandRaiseHesitation();
            }

            const matchedIds = Array.isArray(data.raised_hand_avatar_ids)
              ? new Set<string>(data.raised_hand_avatar_ids)
              : new Set<string>();
            const ratio =
              typeof data.raised_hand_ratio === 'number'
                ? Math.max(0, Math.min(1, data.raised_hand_ratio))
                : matchedIds.size / Math.max(1, currentAudience.length);

            // Persist this hand-raise event into handRaiseHistoryRef and each avatar's learnedTraits!
            const raisedArr = Array.from(matchedIds);
            const notRaisedArr = currentAudience
              .filter((a) => !matchedIds.has(a.id))
              .map((a) => a.id);
            const meta = data.hand_raise_meta || {};
            const affTrait =
              meta.affirmativeTrait || `「${cleanInput}」の質問で挙手した（該当）`;
            const negTrait =
              meta.negativeTrait || `「${cleanInput}」の質問で挙手しなかった（非該当）`;

            handRaiseHistoryRef.current = [
              ...handRaiseHistoryRef.current,
              {
                prompt: cleanInput,
                topicKey: meta.topicKey,
                isNegativePrompt: meta.isNegativePrompt,
                raisedAvatarIds: raisedArr,
                notRaisedAvatarIds: notRaisedArr,
                affirmativeTrait: affTrait,
                negativeTrait: negTrait,
                timestamp: Date.now(),
              },
            ];

            // Ensure at least ~950ms of subtle glancing around ('キョロキョロ') before hands go up
            const elapsedHesitation = Date.now() - lastHandRaiseHesitationStartRef.current;
            const remainingHesitationMs = Math.max(0, 950 - elapsedHesitation);

            setTimeout(() => {
              setThinkingState(null);
              triggerRealisticHandRaise(
                matchedIds,
                ratio,
                5500,
                meta.topicKey || '',
                Boolean(meta.isNegativePrompt)
              );
            }, remainingHesitationMs);

            setAudience((prev) => {
              const next = prev.map((a) => {
                const newTrait = matchedIds.has(a.id) ? affTrait : negTrait;
                return {
                  ...a,
                  learnedTraits: Array.from(
                    new Set([...(a.learnedTraits || []), newTrait])
                  ),
                  interestScore: reaction.interest_score ?? a.interestScore,
                  understandingScore:
                    reaction.understanding_score ?? a.understandingScore,
                  emotion: reaction.emotion || a.emotion,
                };
              });
              audienceRef.current = next;
              return next;
            });
          } else {
            if (isExplicitHandRaiseCue || isHesitatingHandRef.current) {
              isHesitatingHandRef.current = false;
              setThinkingState(null);
            }
            const isHandRaiseLocked = Date.now() < handRaiseLockUntilRef.current;

            setAudience((prev) =>
              prev.map((a) => {
                if (activeCalloutTarget && a.id === activeCalloutTarget.id) {
                  return {
                    ...a,
                    interestScore: reaction.interest_score ?? a.interestScore,
                    understandingScore:
                      reaction.understanding_score ?? a.understandingScore,
                    emotion: reaction.emotion || a.emotion,
                  };
                }
                if (
                  isHandRaiseLocked &&
                  (a.currentAction === 'raised_hand' || a.currentAction === 'hesitate_hand')
                ) {
                  return {
                    ...a,
                    interestScore: reaction.interest_score ?? a.interestScore,
                    understandingScore:
                      reaction.understanding_score ?? a.understandingScore,
                    emotion: reaction.emotion || a.emotion,
                  };
                }
                if (isClapping) {
                  return {
                    ...a,
                    currentAction: 'clap',
                    interestScore: reaction.interest_score ?? a.interestScore,
                    understandingScore:
                      reaction.understanding_score ?? a.understandingScore,
                    emotion: 'Impressed',
                  };
                }
                if (isVeryBored) {
                  return {
                    ...a,
                    currentAction: 'sleep',
                    interestScore: reaction.interest_score ?? a.interestScore,
                    understandingScore:
                      reaction.understanding_score ?? a.understandingScore,
                    emotion: 'Bored',
                  };
                }
                if (a.id === reaction.avatar_id && !isSlightlyBored) {
                  return {
                    ...a,
                    currentAction:
                      reaction.action === 'sleep'
                        ? 'idle'
                        : reaction.action || 'idle',
                    interestScore: reaction.interest_score ?? a.interestScore,
                    understandingScore:
                      reaction.understanding_score ?? a.understandingScore,
                    emotion: reaction.emotion || a.emotion,
                  };
                }
                return {
                  ...a,
                  currentAction:
                    !isSlightlyBored &&
                    reaction.action === 'nod' &&
                    Math.random() > 0.75
                      ? 'nod'
                      : 'idle',
                  interestScore: reaction.interest_score ?? a.interestScore,
                  understandingScore:
                    reaction.understanding_score ?? a.understandingScore,
                  emotion: reaction.emotion || a.emotion,
                };
              })
            );

            if (
              !isHandRaiseLocked &&
              !isVeryBored &&
              (reaction.action === 'nod' ||
                reaction.action === 'tilt_head' ||
                isClapping)
            ) {
              setTimeout(
                () => {
                  if (Date.now() < handRaiseLockUntilRef.current) return;
                  setAudience((prev) =>
                    prev.map((a) =>
                      (!activeCalloutTarget || a.id !== activeCalloutTarget.id) &&
                      (a.currentAction === 'nod' ||
                        a.currentAction === 'tilt_head' ||
                        a.currentAction === 'clap')
                        ? { ...a, currentAction: 'idle' }
                        : a
                    )
                  );
                },
                isClapping ? 3400 : 2000
              );
            }
          }

          const newPoint: TranscriptPoint = {
            time: currentSec,
            text: cleanInput,
            interest: reaction.interest_score ?? 70,
            understanding: reaction.understanding_score ?? 65,
            emotion: reaction.emotion || 'Interested',
            action:
              data.is_hand_raise_prompt && sentenceActuallyAsksForHands
                ? 'raised_hand'
                : isClapping
                ? 'clap'
                : isVeryBored
                ? 'sleep'
                : reaction.action || 'idle',
            avatarId: reaction.avatar_id || currentAudience[0]?.id || 'avatar-1',
            comment: data.quick_comment,
          };

          setTranscriptLog((prev) => {
            const lastItem = prev[prev.length - 1];
            if (lastItem && isNearDuplicateSentence(lastItem.text, newPoint.text)) {
              return prev;
            }
            const next = [...prev, newPoint];
            transcriptLogRef.current = next;
            if (isFirstPresentationEnd) {
              generateEndOfPresentationQAQuestions(next);
            }
            return next;
          });

          if (isFirstPresentationEnd) {
            setEndNotification({ show: true, countdown: 4 });
          }
        }
      } catch (err) {
        console.error('Error in internal sentence analysis:', err);
        if (isExplicitHandRaiseCue || isHesitatingHandRef.current) {
          isHesitatingHandRef.current = false;
          setThinkingState(null);
        }
      } finally {
        setIsAnalyzing(false);
      }
    },
    [
      acquireAvatarAnswerLock,
      executeAnswerToPriorContent,
      generateEndOfPresentationQAQuestions,
      releaseAvatarAnswerLock,
      startHandRaiseHesitation,
      triggerApplauseEffect,
      triggerRealisticHandRaise,
    ]
  );

  // Initialize Speech Recognition - Mounted ONCE, remains uninterrupted for whole presentation
  useEffect(() => {
    const recognizer = new PresentationSpeechRecognizer({
      onInterim: (text) => {
        const currentAudience = audienceRef.current;
        const hasText = Boolean(text && text.trim());

        // アバターが質問に対して回答中は、途中認識（onInterim）による割り込みや再指名・タイマー解除をすべてブロックする
        if (isAvatarAnsweringRef.current) {
          setIsCurrentlySpeaking(false);
          return;
        }

        setIsCurrentlySpeaking(hasText);
        if (hasText) {
          lastSpeechActivityTimeRef.current = Date.now();
          if (
            nominationWaitTimerRef.current &&
            isMeaningfulSpeechUtterance(text)
          ) {
            clearTimeout(nominationWaitTimerRef.current);
            nominationWaitTimerRef.current = null;
            const targetAvatar =
              pendingCalloutAvatarRef.current?.avatar ||
              (focusAvatarIdRef.current
                ? currentAudience.find((a) => a.id === focusAvatarIdRef.current)
                : null);
            if (targetAvatar && !isAvatarAnsweringRef.current) {
              setAudienceReplyBubble({
                speakerLabel: targetAvatar.name,
                text: '（質問を聞いています…）',
                isSpeaking: false,
              });
            }
          }
          if (
            (pendingCalloutAvatarRef.current || focusAvatarIdRef.current) &&
            !isAvatarAnsweringRef.current &&
            isMeaningfulSpeechUtterance(text)
          ) {
            if (activeThinkingBridgeRef.current) {
              activeThinkingBridgeRef.current.cancelBridge();
              activeThinkingBridgeRef.current = null;
            }
          }
          if (
            postCalloutWaitTimerRef.current &&
            isMeaningfulSpeechUtterance(text)
          ) {
            clearTimeout(postCalloutWaitTimerRef.current);
            postCalloutWaitTimerRef.current = null;
          }
        }

        if (
          /(手を挙げ|手をあげ|手を上げ|てをあげ|挙手|手をお挙げ|手をおあげ)/.test(
            text
          )
        ) {
          if (!isHesitatingHandRef.current) {
            startHandRaiseHesitation();
          }
          return;
        }

        // Request #1: If user is currently speaking important keywords, immediately switch audience to taking notes!
        if (
          /(重要|大事な|ポイント|結論|結果|提案|手法|課題|目的|理由|なぜなら|したがって|つまり|まとめ|特徴|メリット|効果|データ|実験|発見|根拠)/.test(
            text
          )
        ) {
          setAudienceMood('important');
          setSleepingRatio(0);
        }

        const directInterimTarget = currentAudience.find((a) => {
          const family = a.name.replace(/[\s(（].*$/, '').trim();
          return (
            text.includes(family) ||
            (family.length >= 2 && text.includes(family.slice(0, 2))) ||
            (a.role === 'professor' && /(教授|先生)/.test(text))
          );
        });
        const calloutTarget =
          directInterimTarget ||
          (pendingCalloutAvatarRef.current &&
          Date.now() - pendingCalloutAvatarRef.current.time < 45000
            ? pendingCalloutAvatarRef.current.avatar
            : undefined);

        if (calloutTarget) {
          // Ensure pendingCalloutAvatarRef is immediately populated when the camera focuses on interim nomination
          if (
            directInterimTarget &&
            (!pendingCalloutAvatarRef.current ||
              pendingCalloutAvatarRef.current.avatar.id !== directInterimTarget.id)
          ) {
            nominationSilenceUntilRef.current = Date.now() + 3000;
            pendingCalloutAvatarRef.current = {
              avatar: directInterimTarget,
              time: Date.now(),
              priorStatement:
                recentInquiryRef.current &&
                Date.now() - recentInquiryRef.current.time < 18000
                  ? recentInquiryRef.current.text
                  : '',
            };
          }
          setFocusAvatar(calloutTarget.id);
          setSleepingRatio(0);
          setAudience((prev) =>
            prev.map((a) =>
              a.id === calloutTarget.id
                ? { ...a, currentAction: 'nod' }
                : a
            )
          );
        }

        const now = Date.now();
        if (text && now - lastFastPathGreetingTimeRef.current > 4000) {
          const fastGreeting = detectFastPathGreeting(text, audienceRef.current);
          if (
            fastGreeting &&
            !firedGreetingRepliesRef.current.has(fastGreeting.replyText)
          ) {
            firedGreetingRepliesRef.current.add(fastGreeting.replyText);
            lastFastPathGreetingTimeRef.current = now;
            handleFastPathGreeting(fastGreeting);
          }
        }
      },
      onFinal: (sentence) => {
        setIsCurrentlySpeaking(false);
        handleFinalSentence(sentence);
      },
      onError: (err) => console.warn('Speech recognizer notification:', err),
    });

    recognizer.start();
    recognizerRef.current = recognizer;

    return () => {
      recognizer.stop();
      if (handRaiseResetTimerRef.current) {
        clearTimeout(handRaiseResetTimerRef.current);
      }
      if (nominationWaitTimerRef.current) {
        clearTimeout(nominationWaitTimerRef.current);
      }
      if (postCalloutWaitTimerRef.current) {
        clearTimeout(postCalloutWaitTimerRef.current);
      }
      if (answerLockWatchdogRef.current) {
        clearTimeout(answerLockWatchdogRef.current);
      }
      if (answerUnlockTimerRef.current) {
        clearTimeout(answerUnlockTimerRef.current);
      }
    };
  }, [handleFastPathGreeting, handleFinalSentence, triggerRealisticHandRaise]);

  // Finish presentation and proceed to Q&A
  const handleFinishPresentation = async () => {
    if (hasFinishedPresentationRef.current) return;
    hasFinishedPresentationRef.current = true;
    activeAnswerLockIdRef.current++;
    isAvatarAnsweringRef.current = false;

    recognizerRef.current?.stop();
    if (endTimerRef.current) clearTimeout(endTimerRef.current);
    if (nominationWaitTimerRef.current) {
      clearTimeout(nominationWaitTimerRef.current);
    }
    if (postCalloutWaitTimerRef.current) {
      clearTimeout(postCalloutWaitTimerRef.current);
    }
    if (answerLockWatchdogRef.current) {
      clearTimeout(answerLockWatchdogRef.current);
    }
    if (answerUnlockTimerRef.current) {
      clearTimeout(answerUnlockTimerRef.current);
    }
    if (activeThinkingBridgeRef.current) {
      activeThinkingBridgeRef.current.cancelBridge();
      activeThinkingBridgeRef.current = null;
    }
    cancelActiveSpeech(true, true);

    let finalQuestions = preparedQAQuestionsRef.current;
    if (qaGenerationPromiseRef.current) {
      finalQuestions = await qaGenerationPromiseRef.current;
    }

    onFinishToQA(
      transcriptLogRef.current,
      finalQuestions,
      elapsedSecRef.current,
      showAvatarSubtitles
    );
  };

  // Format timer
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const displayTime =
    config.timerMode === 'countdown'
      ? Math.max(0, totalDurationSec - elapsedSec)
      : elapsedSec;

  const isTimeNearEnd =
    config.timerMode === 'countdown' && displayTime <= 60 && displayTime > 0;
  const isTimeOver = config.timerMode === 'countdown' && displayTime === 0;

  // Average audience scores
  const avgInterest = Math.round(
    audience.reduce((acc, a) => acc + a.interestScore, 0) / (audience.length || 1)
  );
  const avgUnderstanding = Math.round(
    audience.reduce((acc, a) => acc + a.understandingScore, 0) /
      (audience.length || 1)
  );

  return (
    <div className="relative w-full h-[calc(100vh-3.5rem)] bg-slate-900 overflow-hidden flex flex-col">
      {/* 1. Main 3D Stage */}
      <div className="absolute inset-0 z-0">
        <Audience3DStage
          audience={audience}
          totalAudienceCount={config.totalAudienceCount}
          audienceMood={audienceMood}
          raisedHandRatio={raisedHandRatio}
          handRaiseTopicKey={handRaiseTopicKey}
          isNegativeHandRaise={isNegativeHandRaise}
          sleepingRatio={sleepingRatio}
          sneezeTrigger={sneezeTrigger}
          focusAvatarId={focusAvatarId}
        />
      </div>

      {/* Floating Thinking Toast */}
      {thinkingState?.isThinking && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 bg-white/95 border border-[#5b93c8]/40 rounded-[20px] shadow-[0_8px_24px_0_rgba(15,23,42,0.14)] backdrop-blur-md flex items-center gap-3 pointer-events-none">
          <Brain className="w-4 h-4 text-[#5b93c8] animate-pulse shrink-0" />
          <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-950">
            {thinkingState.avatarName && (
              <span className="text-[#5b93c8] font-extrabold shrink-0">
                {thinkingState.avatarName}
              </span>
            )}
            <span>{thinkingState.text || '思考中…'}</span>
          </div>
        </div>
      )}

      {/* Floating Overhead Speech Bubble for Audience Responses */}
      {audienceReplyBubble && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 w-full max-w-lg px-4 pointer-events-auto">
          {showAvatarSubtitles ? (
            <div className="p-4 bg-white/95 backdrop-blur-md border border-white/90 rounded-[20px] shadow-[0_10px_28px_0_rgba(15,23,42,0.16)] space-y-1 text-center">
              <div className="flex items-center justify-center gap-1.5 text-xs text-[#5b93c8] font-bold">
                <span>{audienceReplyBubble.speakerLabel}</span>
                {audienceReplyBubble.isSpeaking && (
                  <Volume2 className="w-3.5 h-3.5 text-[#5bc8ac] ml-1" />
                )}
              </div>
              <p className="text-sm sm:text-base text-slate-950 font-bold leading-relaxed">
                「{audienceReplyBubble.text}」
              </p>
            </div>
          ) : (
            <div className="mx-auto w-fit px-4 py-2 bg-white/95 backdrop-blur-md border border-white/80 rounded-[16px] shadow-[0_8px_24px_0_rgba(15,23,42,0.14)] flex items-center gap-2 text-xs text-slate-950 font-bold">
              <Volume2 className="w-3.5 h-3.5 text-[#5b93c8]" />
              <span>{audienceReplyBubble.speakerLabel}</span>
            </div>
          )}
        </div>
      )}

      {/* Spend Cap Notification Banner */}
      {spendCapWarning && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 w-full max-w-xl px-4 pointer-events-auto">
          <div className="p-4 bg-white/95 border border-slate-200 rounded-[20px] shadow-[0_10px_28px_0_rgba(15,23,42,0.16)] flex items-start justify-between gap-3 text-slate-950 backdrop-blur-md">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-[#5b93c8] shrink-0 mt-0.5" />
              <p className="text-xs text-slate-900 leading-relaxed">
                {spendCapWarning}
              </p>
            </div>
            <button
              onClick={() => setSpendCapWarning(null)}
              className="text-slate-900 hover:text-[#5b93c8] p-1 rounded-lg text-xs shrink-0 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Automatic Presentation End Notification Banner */}
      {endNotification.show && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 w-full max-w-lg px-4 pointer-events-auto">
          <div className="p-4 bg-white/95 backdrop-blur-md border border-[#5bc8ac]/50 rounded-[20px] shadow-[0_10px_28px_0_rgba(15,23,42,0.18)] flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-[10px] bg-[#5bc8ac]/15 text-[#5bc8ac] flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-950">
                  発表終了を検知（{endNotification.countdown}秒後に質疑応答へ）
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => {
                  hasDetectedPresentationEndRef.current = false;
                  endNotificationRef.current = { show: false, countdown: 4 };
                  preparedQAQuestionsRef.current = [];
                  setEndNotification({ show: false, countdown: 4 });
                }}
                className="px-3 py-1.5 text-xs font-bold text-slate-900 hover:text-[#5b93c8] bg-slate-100 rounded-[10px] transition-colors cursor-pointer"
              >
                続ける
              </button>
              <button
                onClick={handleFinishPresentation}
                className="px-3.5 py-1.5 text-xs font-bold text-white bg-[#5bc8ac] hover:opacity-90 rounded-[10px] transition-opacity flex items-center gap-1 cursor-pointer"
              >
                <span>質疑応答へ</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Top HUD Bar */}
      <div className="relative z-10 w-full px-4 sm:px-6 py-3 flex items-center justify-between gap-4 pointer-events-none">
        {/* Left: Audience Metrics */}
        <div className="pointer-events-auto flex items-center gap-4 bg-white/95 backdrop-blur-md border border-white/80 px-4 py-2 rounded-[16px] shadow-[0_8px_20px_0_rgba(15,23,42,0.10)] text-xs text-slate-950 font-semibold">
          <span>
            関心度{' '}
            <strong className="text-[#5b93c8] font-bold">
              {avgInterest}%
            </strong>
          </span>
          <span className="text-slate-300" aria-hidden="true">
            |
          </span>
          <span>
            理解度{' '}
            <strong className="text-[#5bc8ac] font-bold">
              {avgUnderstanding}%
            </strong>
          </span>
        </div>

        {/* Center: Timer Display */}
        <div className="pointer-events-auto flex items-center gap-2 bg-white/95 backdrop-blur-md border border-white/80 px-5 py-1.5 rounded-[16px] shadow-[0_8px_20px_0_rgba(15,23,42,0.10)]">
          <Clock
            className={`w-4 h-4 ${
              isTimeOver || isTimeNearEnd ? 'text-[#5bc8ac]' : 'text-[#5b93c8]'
            }`}
          />
          <span className="text-xl font-extrabold tracking-tight tabular-nums text-slate-950">
            {formatTime(displayTime)}
          </span>
        </div>

        {/* Right: Controls */}
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            onClick={() => setShowAvatarSubtitles(!showAvatarSubtitles)}
            className={`px-3 py-2 text-xs font-bold rounded-[14px] border transition-colors shadow-[0_8px_20px_0_rgba(15,23,42,0.10)] flex items-center gap-1.5 cursor-pointer backdrop-blur-md ${
              showAvatarSubtitles
                ? 'bg-[#5b93c8] border-[#5b93c8] text-white'
                : 'bg-white/95 border-white/80 text-slate-950 hover:text-[#5b93c8]'
            }`}
          >
            <Subtitles className="w-4 h-4" />
            <span className="hidden sm:inline">吹き出し</span>
          </button>

          {hasVideoTrack && (
            <button
              onClick={() => setShowWebcam(!showWebcam)}
              className="p-2 text-slate-950 hover:text-[#5b93c8] bg-white/95 backdrop-blur-md border border-white/80 rounded-[14px] transition-colors shadow-[0_8px_20px_0_rgba(15,23,42,0.10)] cursor-pointer"
              title={showWebcam ? 'カメラを隠す' : 'カメラを表示'}
            >
              {showWebcam ? (
                <Eye className="w-4 h-4 text-[#5b93c8]" />
              ) : (
                <EyeOff className="w-4 h-4 text-slate-900" />
              )}
            </button>
          )}

          <button
            onClick={handleFinishPresentation}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#5b93c8] hover:bg-[#4a80b5] text-white text-xs font-bold rounded-[14px] shadow-[0_8px_20px_0_rgba(15,23,42,0.12)] transition-colors cursor-pointer"
          >
            <span>質疑応答へ</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Floating Picture-in-Picture Webcam Tile (Resizable + Horizontal Flip Toggle) */}
      {hasVideoTrack && showWebcam && (
        <div
          style={{ width: `${webcamWidth}px`, maxWidth: 'calc(100vw - 2rem)' }}
          className="absolute top-16 right-4 sm:right-6 z-20 aspect-video bg-slate-900 border-2 border-white/90 rounded-[16px] overflow-hidden shadow-[0_12px_30px_0_rgba(15,23,42,0.28)] pointer-events-auto group select-none"
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover transition-transform duration-150 ${
              isCameraMirrored ? '-scale-x-100' : ''
            }`}
          />

          {/* Top Control Bar: Horizontal Flip & Size Controls */}
          <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between gap-1.5 pointer-events-auto">
            <button
              type="button"
              onClick={() => setIsCameraMirrored((prev) => !prev)}
              className="px-2.5 py-1 rounded-[9px] bg-slate-900/80 hover:bg-slate-900 text-white border border-white/25 text-[11px] font-bold flex items-center gap-1 backdrop-blur-sm transition-colors cursor-pointer shadow-sm"
              title="映像の左右反転を切り替え（パワポ等の文字が反転する場合にクリック）"
            >
              <FlipHorizontal2 className="w-3.5 h-3.5 text-[#5bc8ac] shrink-0" />
              <span>{isCameraMirrored ? '左右反転中' : '正像（反転OFF）'}</span>
            </button>

            <div className="flex items-center gap-1 bg-slate-900/80 border border-white/25 rounded-[9px] p-0.5 backdrop-blur-sm shadow-sm">
              <button
                type="button"
                onClick={() => setWebcamWidth((w) => clampWebcamWidth(w - 60))}
                disabled={webcamWidth <= MIN_WEBCAM_WIDTH}
                className="p-1 text-white hover:text-[#5bc8ac] disabled:opacity-35 transition-colors cursor-pointer"
                title="映像ボックスを縮小"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setWebcamWidth((w) => clampWebcamWidth(w + 60))}
                disabled={webcamWidth >= MAX_WEBCAM_WIDTH}
                className="p-1 text-white hover:text-[#5bc8ac] disabled:opacity-35 transition-colors cursor-pointer"
                title="映像ボックスを拡大"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Bottom-Left Drag Resize Handle */}
          <div
            onPointerDown={handleWebcamResizePointerDown}
            onPointerMove={handleWebcamResizePointerMove}
            onPointerUp={handleWebcamResizePointerUp}
            onPointerCancel={handleWebcamResizePointerUp}
            className="absolute bottom-0 left-0 z-10 w-7 h-7 bg-slate-900/80 hover:bg-[#5b93c8] text-white border-t border-r border-white/30 rounded-tr-[10px] flex items-center justify-center cursor-nesw-resize touch-none transition-colors"
            title="ドラッグしてサイズ変更（最小160px〜最大680px）"
          >
            <MoveDiagonal2 className="w-3.5 h-3.5" />
          </div>
        </div>
      )}

      {/* 3. Bottom Oscilloscope Voice Monitor Bar (Preserves real-time wavelength animation) */}
      <div className="mt-auto relative z-20 w-full px-4 pb-3.5 pt-1 max-w-lg mx-auto pointer-events-auto">
        <div className="px-4 py-2.5 bg-white/95 backdrop-blur-md border border-white/90 rounded-[20px] shadow-[0_10px_25px_0_rgba(15,23,42,0.14)] flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 transition-colors ${
              isCurrentlySpeaking
                ? 'bg-[#5bc8ac] text-white'
                : 'bg-[#5b93c8]/15 text-[#5b93c8]'
            }`}
          >
            <Mic className="w-4 h-4" />
          </div>

          {/* Real-time Oscilloscope Waveform Canvas */}
          <div className="flex-1 h-9 bg-slate-900 rounded-[12px] overflow-hidden relative flex items-center">
            <canvas
              ref={oscilloscopeCanvasRef}
              className="w-full h-full block"
            />
          </div>

          <span className="text-xs font-bold text-slate-950 shrink-0 tabular-nums">
            {recognizedCount}文
          </span>
        </div>
      </div>
    </div>
  );
};
