import React, { useState, useEffect, useRef } from 'react';
import {
  AudienceMember,
  QuestionItem,
  TranscriptPoint,
} from '../types/presentation';
import { Audience3DStage } from './Audience3DStage';
import {
  speakText,
  cancelActiveSpeech,
  PresentationSpeechRecognizer,
  isMeaningfulSpeechUtterance,
  preloadTtsAudio,
  runThinkingBridgeSequence,
} from '../utils/speech';
import {
  Hand,
  Volume2,
  Mic,
  CheckCircle2,
  ArrowRight,
  MessageSquare,
  HelpCircle,
  RotateCcw,
  Subtitles,
  Brain,
} from 'lucide-react';

interface QAViewProps {
  audience: AudienceMember[];
  totalAudienceCount?: number;
  initialShowAvatarSubtitles?: boolean;
  mediaStream?: MediaStream | null;
  questions: QuestionItem[];
  transcript: TranscriptPoint[];
  onFinishToReport: (
    resolvedQuestions: QuestionItem[],
    updatedTranscript: TranscriptPoint[]
  ) => void;
}

export const QAView: React.FC<QAViewProps> = ({
  audience,
  totalAudienceCount,
  initialShowAvatarSubtitles = false,
  mediaStream = null,
  questions,
  transcript,
  onFinishToReport,
}) => {
  // Question items list (can have 0, 1, or multiple questions per avatar)
  const [questionList, setQuestionList] = useState<QuestionItem[]>(questions);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState<boolean>(
    questions.length === 0 && transcript.length >= 2
  );

  // Thinking / Pondering Toast State
  const [thinkingState, setThinkingState] = useState<{
    isThinking: boolean;
    text?: string;
    avatarName?: string;
  } | null>(null);

  // Avatar subtitle visibility toggle (initialized from Setup / Practice)
  const [showAvatarSubtitles, setShowAvatarSubtitles] = useState<boolean>(
    initialShowAvatarSubtitles
  );

  // Unresolved questions
  const unresolvedQuestions = questionList.filter((q) => !q.isResolved);

  // Nominated question ID & active question
  const [nominatedQuestionId, setNominatedQuestionId] = useState<string | null>(null);
  const activeQuestion =
    questionList.find(
      (q) => q.id === nominatedQuestionId && !q.isResolved
    ) || null;
  const nominatedAvatarId = activeQuestion?.avatarId || null;

  // 3D Audience state for raised hands & camera zoom
  const [qaAudience, setQaAudience] = useState<AudienceMember[]>(audience);

  // TTS audio playback & typing animation state
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState<boolean>(false);
  const [typedQuestionText, setTypedQuestionText] = useState<string>('');

  // User answer input: separate committed (finalized) and interim (in-flight live speech)
  // Stored internally for AI evaluation and report log; UI shows oscilloscope waveform instead of text subtitle
  const [committedAnswer, setCommittedAnswer] = useState<string>('');
  const [interimAnswer, setInterimAnswer] = useState<string>('');
  const [, setIsUserListening] = useState<boolean>(false);

  // 回答評価中ステータス & 質問者の納得/追加質問フィードバック
  const [isEvaluatingAnswer, setIsEvaluatingAnswer] = useState<boolean>(false);
  const [avatarFeedback, setAvatarFeedback] = useState<{
    text: string;
    isSatisfied: boolean;
  } | null>(null);

  // 回答終了確認ダイアログ表示フラグ
  const [showFinishConfirmDialog, setShowFinishConfirmDialog] = useState<boolean>(false);

  // State refs to keep speech callbacks decoupled from component re-renders
  const nominatedQuestionIdRef = useRef<string | null>(nominatedQuestionId);
  nominatedQuestionIdRef.current = nominatedQuestionId;

  const nominatedAvatarIdRef = useRef<string | null>(nominatedAvatarId);
  nominatedAvatarIdRef.current = nominatedAvatarId;

  const unresolvedQuestionsRef = useRef<QuestionItem[]>(unresolvedQuestions);
  unresolvedQuestionsRef.current = unresolvedQuestions;

  const isAvatarSpeakingRef = useRef<boolean>(isAvatarSpeaking);
  isAvatarSpeakingRef.current = isAvatarSpeaking;

  const isEvaluatingAnswerRef = useRef<boolean>(isEvaluatingAnswer);
  isEvaluatingAnswerRef.current = isEvaluatingAnswer;

  const committedAnswerRef = useRef<string>(committedAnswer);
  committedAnswerRef.current = committedAnswer;

  const interimAnswerRef = useRef<string>(interimAnswer);
  interimAnswerRef.current = interimAnswer;

  const showFinishConfirmDialogRef = useRef<boolean>(showFinishConfirmDialog);
  showFinishConfirmDialogRef.current = showFinishConfirmDialog;

  const finishTimerRef = useRef<any>(null);
  const typingTimerRef = useRef<any>(null);
  const nominationDelayTimerRef = useRef<any>(null);
  const recognizerRef = useRef<PresentationSpeechRecognizer | null>(null);
  const oscilloscopeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastMeaningfulInterimRef = useRef<string>('');

  // 発表内容の文字起こしログから、発表終了後の1回のみ質問を生成（初期0件の場合のみ）
  useEffect(() => {
    if (questions.length > 0) {
      setIsLoadingQuestions(false);
      return;
    }

    if (transcript.length < 2) {
      setIsLoadingQuestions(false);
      return;
    }

    let isMounted = true;
    setIsLoadingQuestions(true);

    fetch('/api/presentation/generate-qa-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcriptHistory: transcript,
        audience,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted) return;
        if (Array.isArray(data.questions)) {
          const generatedItems: QuestionItem[] = data.questions.map(
            (q: any, idx: number) => ({
              id: `qa-gen-${Date.now()}-${idx}`,
              avatarId: q.avatarId || audience[idx % audience.length]?.id || 'avatar-1',
              avatarName: q.avatarName || audience[idx % audience.length]?.name || '聴衆',
              role: (q.role || audience[idx % audience.length]?.role || 'professor') as any,
              questionText: q.questionText,
              isResolved: false,
              followUpCount: 0,
            })
          );
          setQuestionList(generatedItems);
        }
      })
      .catch((err) => {
        console.error('Error generating QA questions:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoadingQuestions(false);
      });

    return () => {
      isMounted = false;
    };
  }, [questions.length, transcript, audience]);

  // Preload TTS audio for all unresolved Q&A questions sequentially in the background for 0ms delay on nomination
  useEffect(() => {
    let isCancelled = false;
    (async () => {
      for (const q of questionList) {
        if (isCancelled) break;
        if (q.isResolved || !q.questionText) continue;
        const targetAvatar =
          audience.find((a) => a.id === q.avatarId) || audience[0];
        if (!targetAvatar) continue;
        await preloadTtsAudio(
          q.questionText,
          targetAvatar.role,
          targetAvatar.gender,
          targetAvatar.voiceName,
          false
        );
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [questionList, audience]);

  // Update 3D hands: Attendees who have unresolved questions raise their hands!
  useEffect(() => {
    const raisedAvatarIds = new Set(unresolvedQuestions.map((q) => q.avatarId));

    setQaAudience((prev) =>
      prev.map((a) => {
        if (nominatedAvatarId === a.id) {
          return { ...a, currentAction: 'nod' };
        }
        if (!nominatedAvatarId && raisedAvatarIds.has(a.id)) {
          return { ...a, currentAction: 'raised_hand' };
        }
        return { ...a, currentAction: 'idle' };
      })
    );
  }, [nominatedAvatarId, unresolvedQuestions.length]);

  // Real-time Oscilloscope Waveform Visualizer for Presenter's Q&A Answer
  useEffect(() => {
    if (!activeQuestion) return;

    let animationFrameId: number;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let dataArray: Uint8Array<ArrayBuffer> | null = null;

    const isAndroid =
      typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

    if (!isAndroid && mediaStream && mediaStream.getAudioTracks().length > 0) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        audioCtx = new AudioCtx();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.82;
        source = audioCtx.createMediaStreamSource(mediaStream);
        source.connect(analyser);
        dataArray = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      } catch {
        // Fallback to synthetic speech-driven oscilloscope
      }
    }

    let phase = 0;
    const renderWave = () => {
      const canvas = oscilloscopeCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const width = canvas.width;
          const height = canvas.height;
          ctx.clearRect(0, 0, width, height);

          // Subtle center reference line
          ctx.strokeStyle = 'rgba(51, 65, 85, 0.35)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, height / 2);
          ctx.lineTo(width, height / 2);
          ctx.stroke();

          const isBlocked = isAvatarSpeakingRef.current || isEvaluatingAnswerRef.current;
          const isSpeakingNow =
            !isBlocked && Boolean(interimAnswerRef.current.trim());

          // Primary wave color
          ctx.strokeStyle = isBlocked
            ? 'rgba(100, 116, 139, 0.45)'
            : isSpeakingNow
            ? '#34d399'
            : '#38bdf8';
          ctx.lineWidth = 2.4;
          ctx.beginPath();

          if (analyser && dataArray && !isBlocked) {
            analyser.getByteTimeDomainData(dataArray);
            const sliceWidth = width / dataArray.length;
            let x = 0;
            let maxDeviation = 0;
            for (let i = 0; i < dataArray.length; i++) {
              const v = dataArray[i] / 128.0;
              const dev = Math.abs(v - 1.0);
              if (dev > maxDeviation) maxDeviation = dev;
            }

            const boost = maxDeviation < 0.02 && isSpeakingNow ? 5.5 : 2.3;

            for (let i = 0; i < dataArray.length; i++) {
              const v = (dataArray[i] - 128) / 128.0;
              const synth =
                maxDeviation < 0.02 && isSpeakingNow
                  ? Math.sin(i * 0.25 + phase) * 0.28 * Math.sin(phase * 0.5)
                  : 0;
              const y = height / 2 + (v * boost + synth) * (height * 0.42);
              if (i === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
              x += sliceWidth;
            }
          } else {
            const amp = isBlocked
              ? 1.5
              : isSpeakingNow
              ? height * 0.32
              : height * 0.06;
            for (let x = 0; x < width; x++) {
              const env = Math.sin((x / width) * Math.PI);
              const y =
                height / 2 +
                (Math.sin(x * 0.055 + phase) * 0.65 +
                  Math.sin(x * 0.12 - phase * 1.4) * 0.35) *
                  amp *
                  env;
              if (x === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
            }
          }
          ctx.stroke();

          // Secondary harmonic wave
          if (!isBlocked) {
            ctx.strokeStyle = isSpeakingNow
              ? 'rgba(52, 211, 153, 0.28)'
              : 'rgba(56, 189, 248, 0.2)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            for (let x = 0; x < width; x++) {
              const env = Math.sin((x / width) * Math.PI);
              const amp2 = isSpeakingNow ? height * 0.2 : height * 0.04;
              const y =
                height / 2 +
                Math.cos(x * 0.04 - phase * 0.9) * amp2 * env;
              if (x === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
            }
            ctx.stroke();
          }

          phase += isSpeakingNow ? 0.22 : 0.07;
        }
      }
      animationFrameId = requestAnimationFrame(renderWave);
    };

    renderWave();

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (source) {
        try {
          source.disconnect();
        } catch {}
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close().catch(() => {});
      }
    };
  }, [activeQuestion?.id, mediaStream]);

  const playQuestionAudio = (questionItem: QuestionItem) => {
    const targetAvatar =
      audience.find((a) => a.id === questionItem.avatarId) || audience[0];

    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }

    const fullText = questionItem.questionText;
    setTypedQuestionText('');
    let charIndex = 0;
    typingTimerRef.current = setInterval(() => {
      charIndex++;
      setTypedQuestionText(fullText.slice(0, charIndex));
      if (charIndex >= fullText.length) {
        clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    }, 35);

    speakText(
      fullText,
      targetAvatar.role,
      targetAvatar.gender,
      () => {
        setIsAvatarSpeaking(true);
        isAvatarSpeakingRef.current = true;
      },
      () => {
        setIsAvatarSpeaking(false);
        isAvatarSpeakingRef.current = false;
      },
      { voiceName: targetAvatar.voiceName, avatarId: targetAvatar.id, isProtected: true }
    );
  };

  // Automatic Answer Completion Detection Timer:
  // Schedules the "質問への回答を終了しますか？" dialog after user pauses speaking meaningful answer content.
  // Ignores minor ambient sounds or short non-speech noise.
  const scheduleAnswerFinishCheck = (currentFullAnswer: string) => {
    if (!nominatedQuestionIdRef.current) return;
    if (isAvatarSpeakingRef.current || isEvaluatingAnswerRef.current) return;

    const cleanTotal = currentFullAnswer.trim();
    if (!isMeaningfulSpeechUtterance(cleanTotal)) return;

    if (finishTimerRef.current) {
      clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }

    // Check if the answer ends with a natural Japanese sentence ending
    const hasTerminalEnding =
      /(です|ます|ました|ません|でした|思います|考えています|考えております|以上です|となります|になります|からです|ためです|通りです|ございます)[。！？!?]*$/.test(
        cleanTotal
      );
    const waitMs = hasTerminalEnding ? 1450 : 2150;

    finishTimerRef.current = setTimeout(() => {
      finishTimerRef.current = null;
      if (
        !nominatedQuestionIdRef.current ||
        isAvatarSpeakingRef.current ||
        isEvaluatingAnswerRef.current
      ) {
        return;
      }

      // Flush any uncommitted meaningful interim speech into committedAnswer so it isn't lost
      const pendingInterim = interimAnswerRef.current.trim();
      if (pendingInterim && isMeaningfulSpeechUtterance(pendingInterim)) {
        const merged = committedAnswerRef.current
          ? `${committedAnswerRef.current} ${pendingInterim}`
          : pendingInterim;
        committedAnswerRef.current = merged;
        setCommittedAnswer(merged);
        interimAnswerRef.current = '';
        setInterimAnswer('');
      }

      const finalRecorded = (
        committedAnswerRef.current || interimAnswerRef.current
      ).trim();

      if (isMeaningfulSpeechUtterance(finalRecorded)) {
        setShowFinishConfirmDialog(true);
        showFinishConfirmDialogRef.current = true;
      }
    }, waitMs);
  };

  // Handle Nomination of a specific question:
  // 1. Immediately focus camera on nominated avatar
  // 2. Play question audio immediately with preloaded cache
  const handleNominateQuestion = (questionId: string) => {
    if (nominatedQuestionIdRef.current === questionId) return;

    const targetQ = unresolvedQuestionsRef.current.find((q) => q.id === questionId);
    if (!targetQ) return;

    if (finishTimerRef.current) {
      clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }
    if (nominationDelayTimerRef.current) {
      clearTimeout(nominationDelayTimerRef.current);
      nominationDelayTimerRef.current = null;
    }
    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }

    recognizerRef.current?.clearBuffer();
    cancelActiveSpeech(true);

    // Immediately set ref and state so camera zooms right away with zero lag
    nominatedQuestionIdRef.current = questionId;
    nominatedAvatarIdRef.current = targetQ.avatarId;
    setNominatedQuestionId(questionId);

    setCommittedAnswer('');
    committedAnswerRef.current = '';
    setInterimAnswer('');
    interimAnswerRef.current = '';
    lastMeaningfulInterimRef.current = '';
    setShowFinishConfirmDialog(false);
    showFinishConfirmDialogRef.current = false;
    setAvatarFeedback(null);
    setTypedQuestionText('');

    // Block mic input during the 1-second natural pause and while avatar speaks
    setIsAvatarSpeaking(true);
    isAvatarSpeakingRef.current = true;

    // Wait 1.0 second after camera focus before the nominated avatar begins speaking their question
    nominationDelayTimerRef.current = setTimeout(() => {
      nominationDelayTimerRef.current = null;
      playQuestionAudio(targetQ);
    }, 1000);
  };

  // Helper to match spoken text against unresolved questioners
  const findMatchingUnresolvedQuestion = (spokenText: string): QuestionItem | null => {
    if (nominatedQuestionIdRef.current || unresolvedQuestionsRef.current.length === 0) {
      return null;
    }
    for (const q of unresolvedQuestionsRef.current) {
      const shortName = q.avatarName.replace(/[\s(（].*$/, '').trim();
      if (
        (shortName && spokenText.includes(shortName)) ||
        (shortName.length >= 2 && spokenText.includes(shortName.slice(0, 2))) ||
        spokenText.includes(q.avatarName) ||
        (q.role === 'professor' && /(先生|教授)/.test(spokenText)) ||
        (unresolvedQuestionsRef.current.length === 1 && spokenText.includes('どうぞ'))
      ) {
        return q;
      }
    }
    // If multiple people have hands raised and user just says "どうぞ" without a name, pick the first one
    if (spokenText.includes('どうぞ')) {
      return unresolvedQuestionsRef.current[0] || null;
    }
    return null;
  };

  // Speech recognition: Persistent listener with automatic TTS echo suppression in speech.ts
  useEffect(() => {
    const recognizer = new PresentationSpeechRecognizer({
      onInterim: (text) => {
        const clean = text.trim();
        if (!clean) return;

        // アバターが発話中（またはフォーカス遷移中）またはAI評価中はマイク入力を無視
        if (isAvatarSpeakingRef.current || isEvaluatingAnswerRef.current) return;

        // まだ質問者を指名していない場合: 話している途中（onInterim）で名前や「どうぞ」が出た瞬間に即座にカメラフォーカス！
        if (!nominatedQuestionIdRef.current && unresolvedQuestionsRef.current.length > 0) {
          const matchedQ = findMatchingUnresolvedQuestion(clean);
          if (matchedQ) {
            handleNominateQuestion(matchedQ.id);
            return;
          }
        }

        if (!nominatedQuestionIdRef.current) return;

        // Check whether the newly recognized interim speech is actual meaningful speech (not minor cough/noise/1-char artifact)
        const prevInterim = lastMeaningfulInterimRef.current;
        const deltaText = clean.startsWith(prevInterim)
          ? clean.slice(prevInterim.length).trim()
          : clean;

        // If the confirmation dialog is currently open, ONLY close it if the user actually spoke meaningful continuation words
        if (showFinishConfirmDialogRef.current) {
          if (!isMeaningfulSpeechUtterance(deltaText)) {
            // Ignore minor noise while dialog is open
            return;
          }
          setShowFinishConfirmDialog(false);
          showFinishConfirmDialogRef.current = false;
        }

        // Ignore tiny non-speech noise fragments so they don't reset the completion timer
        if (!isMeaningfulSpeechUtterance(clean) && !committedAnswerRef.current) {
          return;
        }

        if (isMeaningfulSpeechUtterance(deltaText)) {
          lastMeaningfulInterimRef.current = clean;
          interimAnswerRef.current = clean;
          setInterimAnswer(clean);

          const combined = committedAnswerRef.current
            ? `${committedAnswerRef.current} ${clean}`
            : clean;
          scheduleAnswerFinishCheck(combined);
        }
      },
      onFinal: (text) => {
        const clean = text.trim();
        if (!clean) return;

        // アバターが発話中（またはフォーカス遷移中）またはAI評価中はマイク入力を無視
        if (isAvatarSpeakingRef.current || isEvaluatingAnswerRef.current) return;

        // 1. まだ質問者を指名していない場合: 音声呼びかけで即座に指名
        if (!nominatedQuestionIdRef.current && unresolvedQuestionsRef.current.length > 0) {
          const matchedQ = findMatchingUnresolvedQuestion(clean);
          if (matchedQ) {
            handleNominateQuestion(matchedQ.id);
            return;
          }
        }

        // 2. 指名済みで回答中の場合: 発言でない微細な環境音やフィラー単体は無視する
        if (nominatedQuestionIdRef.current) {
          if (!isMeaningfulSpeechUtterance(clean)) {
            interimAnswerRef.current = '';
            setInterimAnswer('');
            return;
          }

          if (showFinishConfirmDialogRef.current) {
            setShowFinishConfirmDialog(false);
            showFinishConfirmDialogRef.current = false;
          }

          const next = committedAnswerRef.current
            ? `${committedAnswerRef.current} ${clean}`
            : clean;
          committedAnswerRef.current = next;
          setCommittedAnswer(next);
          interimAnswerRef.current = '';
          lastMeaningfulInterimRef.current = '';
          setInterimAnswer('');

          scheduleAnswerFinishCheck(next);
        }
      },
      onError: (err) => console.warn('QA Recognizer notice:', err),
      onStatusChange: (status) => setIsUserListening(status),
    });

    recognizer.start();
    recognizerRef.current = recognizer;

    return () => {
      recognizer.stop();
      if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
      if (typingTimerRef.current) clearInterval(typingTimerRef.current);
      if (nominationDelayTimerRef.current) clearTimeout(nominationDelayTimerRef.current);
    };
  }, []);

  // Complete answering active question with Real Interactive Evaluation
  const handleAnswerSubmit = async () => {
    if (!activeQuestion) return;

    if (finishTimerRef.current) {
      clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }

    recognizerRef.current?.clearBuffer();

    setShowFinishConfirmDialog(false);
    showFinishConfirmDialogRef.current = false;

    const finalAnswer =
      committedAnswerRef.current ||
      interimAnswerRef.current ||
      committedAnswer ||
      interimAnswer ||
      '（口頭回答完了）';

    setIsEvaluatingAnswer(true);
    isEvaluatingAnswerRef.current = true;

    setThinkingState({
      isThinking: true,
      text: '回答を分析・評価中…',
      avatarName: activeQuestion.avatarName,
    });

    try {
      const targetAvatar =
        audience.find((a) => a.id === activeQuestion.avatarId) || audience[0];

      setQaAudience((prev) =>
        prev.map((a) =>
          a.id === activeQuestion.avatarId
            ? { ...a, currentAction: 'nod' }
            : a
        )
      );

      setIsAvatarSpeaking(true);
      isAvatarSpeakingRef.current = true;

      // Play varied initial acknowledgment (Stage 1) and automatically bridge with Stage 2 if LLM + TTS take longer
      const evalBridge = runThinkingBridgeSequence({
        role: targetAvatar.role,
        gender: targetAvatar.gender,
        voiceName: targetAvatar.voiceName,
        avatarId: targetAvatar.id,
        stage1Category: 'qa_eval_stage1',
        stage2Category: 'qa_eval_stage2',
      });

      const res = await fetch('/api/presentation/evaluate-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: activeQuestion,
          userAnswer: finalAnswer,
          avatar: targetAvatar,
          recentTranscript: transcript.map((t) => t.text).join(' '),
        }),
      });

      const data = await res.json();
      setThinkingState(null);

      const isSatisfied = Boolean(data.isSatisfied);
      const rawFeedback =
        data.feedbackText ||
        (isSatisfied
          ? 'ご説明ありがとうございました！'
          : '追加で伺えますでしょうか？');
      const followUpText =
        !isSatisfied && data.followUpQuestionText
          ? String(data.followUpQuestionText).trim()
          : '';
      const spokenFeedback =
        followUpText && !rawFeedback.includes(followUpText)
          ? `${rawFeedback} ${followUpText}`
          : rawFeedback;

      // Preload the full feedback TTS audio while the thinking filler/bridge is still speaking!
      await preloadTtsAudio(
        spokenFeedback,
        targetAvatar.role,
        targetAvatar.gender,
        targetAvatar.voiceName
      );
      await evalBridge.waitForBridgeSlot();

      recognizerRef.current?.clearBuffer();

      setAvatarFeedback({
        text: spokenFeedback,
        isSatisfied,
      });

      setQaAudience((prev) =>
        prev.map((a) =>
          a.id === activeQuestion.avatarId
            ? { ...a, currentAction: data.action || (isSatisfied ? 'nod' : 'tilt_head') }
            : a
        )
      );

      setIsAvatarSpeaking(true);
      isAvatarSpeakingRef.current = true;

      speakText(
        spokenFeedback,
        targetAvatar.role,
        targetAvatar.gender,
        () => {
          setIsAvatarSpeaking(true);
          isAvatarSpeakingRef.current = true;
        },
        () => {
          setIsAvatarSpeaking(false);
          isAvatarSpeakingRef.current = false;
          setIsEvaluatingAnswer(false);
          isEvaluatingAnswerRef.current = false;

          if (isSatisfied) {
            setTimeout(() => {
              setQuestionList((prev) =>
                prev.map((q) =>
                  q.id === activeQuestion.id
                    ? {
                        ...q,
                        isResolved: true,
                        userAnswer: finalAnswer,
                        avatarFeedback: rawFeedback,
                      }
                    : q
                )
              );
              setNominatedQuestionId(null);
              nominatedQuestionIdRef.current = null;
              setCommittedAnswer('');
              committedAnswerRef.current = '';
              setInterimAnswer('');
              interimAnswerRef.current = '';
              lastMeaningfulInterimRef.current = '';
              setAvatarFeedback(null);
              setTypedQuestionText('');
            }, 1000);
          } else {
            const followUp = followUpText || rawFeedback;
            const nextFollowUpNumber = (activeQuestion.followUpCount || 0) + 1;
            const followUpId = `${activeQuestion.id}-followup-${nextFollowUpNumber}-${Date.now()}`;

            setQuestionList((prev) => {
              const next: QuestionItem[] = [];
              for (const q of prev) {
                if (q.id === activeQuestion.id) {
                  // Preserve the answered initial/prior question in the Q&A log
                  next.push({
                    ...q,
                    isResolved: true,
                    userAnswer: finalAnswer,
                    avatarFeedback: rawFeedback,
                  });
                  // Append the follow-up question as a new entry right after it
                  next.push({
                    id: followUpId,
                    avatarId: activeQuestion.avatarId,
                    avatarName: activeQuestion.avatarName,
                    role: activeQuestion.role,
                    questionText: followUp,
                    isResolved: false,
                    isFollowUp: true,
                    followUpCount: nextFollowUpNumber,
                  });
                } else {
                  next.push(q);
                }
              }
              return next;
            });

            nominatedQuestionIdRef.current = followUpId;
            setNominatedQuestionId(followUpId);
            setTypedQuestionText(followUp);
            setCommittedAnswer('');
            committedAnswerRef.current = '';
            setInterimAnswer('');
            interimAnswerRef.current = '';
            lastMeaningfulInterimRef.current = '';
          }
        },
        {
          voiceName: targetAvatar.voiceName,
          avatarId: targetAvatar.id,
          isProtected: true,
        }
      );
    } catch (err) {
      console.error('Error evaluating answer:', err);
      setIsEvaluatingAnswer(false);
      isEvaluatingAnswerRef.current = false;
      setQuestionList((prev) =>
        prev.map((q) =>
          q.id === activeQuestion.id
            ? { ...q, isResolved: true, userAnswer: finalAnswer }
            : q
        )
      );
      setNominatedQuestionId(null);
      nominatedQuestionIdRef.current = null;
      setCommittedAnswer('');
      committedAnswerRef.current = '';
      setInterimAnswer('');
      interimAnswerRef.current = '';
      lastMeaningfulInterimRef.current = '';
      setAvatarFeedback(null);
      setTypedQuestionText('');
    }
  };

  // 時間の都合などでこの質問をスキップする機能
  const handleForceResolve = () => {
    if (!activeQuestion) return;
    cancelActiveSpeech();
    setIsAvatarSpeaking(false);
    isAvatarSpeakingRef.current = false;

    const spokenAnswer = (
      committedAnswerRef.current ||
      interimAnswerRef.current ||
      ''
    ).trim();

    setQuestionList((prev) =>
      prev.map((q) =>
        q.id === activeQuestion.id
          ? {
              ...q,
              isResolved: Boolean(spokenAnswer),
              isSkipped: !spokenAnswer,
              userAnswer: spokenAnswer || undefined,
            }
          : q
      )
    );
    setNominatedQuestionId(null);
    nominatedQuestionIdRef.current = null;
    setCommittedAnswer('');
    committedAnswerRef.current = '';
    setInterimAnswer('');
    interimAnswerRef.current = '';
    lastMeaningfulInterimRef.current = '';
    setAvatarFeedback(null);
    setTypedQuestionText('');
  };

  // 質疑応答を終了してレポートへ進む処理（未解決の質問でも途中の発話があれば記録を保持し、未回答のみスキップ扱い）
  const handleFinishToReportSafe = () => {
    cancelActiveSpeech();
    const pendingSpoken = (
      committedAnswerRef.current ||
      interimAnswerRef.current ||
      ''
    ).trim();
    const currentActiveId = nominatedQuestionIdRef.current;

    const updatedList = questionList.map((q) => {
      if (q.id === currentActiveId && !q.isResolved && pendingSpoken) {
        return {
          ...q,
          isResolved: true,
          isSkipped: false,
          userAnswer: pendingSpoken,
        };
      }
      return {
        ...q,
        isSkipped: !q.isResolved,
      };
    });
    onFinishToReport(updatedList, transcript);
  };

  const hasNoQuestionsInitially = !isLoadingQuestions && questionList.length === 0;

  return (
    <div className="relative w-full h-[calc(100vh-3.5rem)] bg-slate-900 overflow-hidden flex flex-col">
      {/* 1. Main 3D Stage */}
      <div className="absolute inset-0 z-0">
        <Audience3DStage
          audience={qaAudience}
          totalAudienceCount={totalAudienceCount}
          focusAvatarId={nominatedAvatarId}
          onAvatarClick={(avatarId) => {
            if (!nominatedQuestionId) {
              const matchedQ = unresolvedQuestions.find((q) => q.avatarId === avatarId);
              if (matchedQ) {
                handleNominateQuestion(matchedQ.id);
              }
            }
          }}
        />
      </div>

      {/* 2. Top Header HUD */}
      <div className="relative z-10 w-full px-4 sm:px-6 py-3 flex items-center justify-between gap-4 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-3 bg-white/95 backdrop-blur-md border border-white/80 px-4 py-2 rounded-[16px] shadow-[0_8px_20px_0_rgba(15,23,42,0.10)] text-xs text-slate-950 font-semibold">
          {isLoadingQuestions ? (
            <span className="flex items-center gap-1.5 text-[#5b93c8] font-bold">
              <span className="w-2 h-2 rounded-full bg-[#5b93c8] animate-ping" />
              <span>質問を準備中...</span>
            </span>
          ) : hasNoQuestionsInitially ? (
            <span className="text-[#5bc8ac] font-bold">質問なし</span>
          ) : (
            <span>
              質問残り{' '}
              <strong className="text-[#5b93c8] font-extrabold">
                {unresolvedQuestions.length}件
              </strong>
            </span>
          )}
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAvatarSubtitles(!showAvatarSubtitles)}
            className={`px-3 py-2 text-xs font-bold rounded-[14px] border transition-colors shadow-[0_8px_20px_0_rgba(15,23,42,0.10)] flex items-center gap-1.5 cursor-pointer backdrop-blur-md ${
              showAvatarSubtitles
                ? 'bg-[#5b93c8] border-[#5b93c8] text-white'
                : 'bg-white/95 border-white/80 text-slate-950 hover:text-[#5b93c8]'
            }`}
          >
            <Subtitles className="w-4 h-4" />
            <span>吹き出し</span>
          </button>

          <button
            onClick={handleFinishToReportSafe}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#5b93c8] hover:bg-[#4a80b5] text-white text-xs font-bold rounded-[14px] shadow-[0_8px_20px_0_rgba(15,23,42,0.12)] transition-colors cursor-pointer"
          >
            <span>レポートへ</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
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

      {/* 3. Central Overhead Panel (Shown when nominated) */}
      {activeQuestion && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 w-full max-w-xl px-4 pointer-events-auto">
          <div className="p-4 sm:p-5 bg-white/95 backdrop-blur-md border border-white/90 rounded-[22px] shadow-[0_12px_30px_0_rgba(15,23,42,0.18)] space-y-2.5 relative">
            <div className="flex items-center justify-between text-xs gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="font-bold text-[#5b93c8] flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>{activeQuestion.avatarName}</span>
                </span>
                {activeQuestion.isFollowUp && (
                  <span className="px-2 py-0.5 rounded-md bg-[#5bc8ac]/20 text-slate-950 text-[10px] font-bold">
                    追加質問
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {!isAvatarSpeaking && (
                  <button
                    type="button"
                    onClick={() => playQuestionAudio(activeQuestion)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200/80 text-[11px] font-bold text-slate-950 rounded-[9px] transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>もう一度聞く</span>
                  </button>
                )}

                {isAvatarSpeaking && (
                  <button
                    type="button"
                    onClick={() => {
                      if (nominationDelayTimerRef.current) {
                        clearTimeout(nominationDelayTimerRef.current);
                        nominationDelayTimerRef.current = null;
                      }
                      if (typingTimerRef.current) {
                        clearInterval(typingTimerRef.current);
                        typingTimerRef.current = null;
                      }
                      cancelActiveSpeech();
                      setTypedQuestionText(activeQuestion.questionText);
                      setIsAvatarSpeaking(false);
                      isAvatarSpeakingRef.current = false;
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#5b93c8]/15 hover:bg-[#5b93c8]/25 text-[11px] font-bold text-[#5b93c8] rounded-[9px] transition-colors cursor-pointer"
                  >
                    <Volume2 className="w-3.5 h-3.5 text-[#5b93c8]" />
                    <span>スキップして回答</span>
                  </button>
                )}
              </div>
            </div>

            {showAvatarSubtitles ? (
              <>
                <p className="text-sm sm:text-base text-slate-950 font-bold leading-relaxed">
                  {typedQuestionText || activeQuestion.questionText}
                </p>

                {avatarFeedback && (
                  <div className="mt-2 p-3 rounded-[14px] text-xs font-semibold bg-slate-50 border border-slate-200 text-slate-950 flex items-start gap-2">
                    {avatarFeedback.isSatisfied ? (
                      <CheckCircle2 className="w-4 h-4 text-[#5bc8ac] shrink-0 mt-0.5" />
                    ) : (
                      <HelpCircle className="w-4 h-4 text-[#5b93c8] shrink-0 mt-0.5" />
                    )}
                    <div className="text-xs text-slate-950">
                      {avatarFeedback.text}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="py-1.5 flex items-center justify-between gap-3 text-xs text-slate-950">
                <div className="flex items-center gap-2 font-semibold">
                  <Volume2
                    className={`w-4 h-4 ${
                      isAvatarSpeaking ? 'text-[#5b93c8]' : 'text-slate-900'
                    }`}
                  />
                  <span>
                    {isAvatarSpeaking ? '質問中...' : '回答してください'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAvatarSubtitles(true)}
                  className="text-[11px] font-bold text-[#5b93c8] hover:underline shrink-0 cursor-pointer"
                >
                  吹き出しを表示
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. Bottom Control Deck */}
      <div className="mt-auto relative z-20 w-full p-4 max-w-3xl mx-auto space-y-3 pointer-events-auto">
        {isLoadingQuestions ? (
          <div className="p-5 bg-white/95 backdrop-blur-md border border-white/90 rounded-[22px] shadow-[0_10px_28px_0_rgba(15,23,42,0.16)] flex items-center gap-3.5">
            <span className="w-5 h-5 rounded-full border-2 border-[#5b93c8]/30 border-t-[#5b93c8] animate-spin shrink-0" />
            <span className="text-sm font-bold text-slate-950">
              質問を準備しています...
            </span>
          </div>
        ) : hasNoQuestionsInitially ? (
          <div className="p-5 bg-white/95 backdrop-blur-md border border-white/90 rounded-[22px] shadow-[0_10px_28px_0_rgba(15,23,42,0.16)] flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#5bc8ac] shrink-0" />
              <span className="text-sm font-bold text-slate-950">
                質問はありませんでした
              </span>
            </div>

            <button
              onClick={() => onFinishToReport([], transcript)}
              className="px-5 py-2.5 bg-[#5b93c8] hover:bg-[#4a80b5] text-white text-xs font-bold rounded-[14px] transition-colors flex items-center gap-2 shrink-0 cursor-pointer"
            >
              <span>レポートを見る</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : !nominatedQuestionId && unresolvedQuestions.length > 0 ? (
          <div className="p-5 bg-white/95 backdrop-blur-md border border-white/90 rounded-[22px] shadow-[0_10px_28px_0_rgba(15,23,42,0.16)] space-y-3">
            <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-950">
              <Hand className="w-4 h-4 text-[#5b93c8]" />
              <span>質問者を指名してください</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {unresolvedQuestions.map((q) => (
                <button
                  key={q.id}
                  onClick={() => handleNominateQuestion(q.id)}
                  className="p-3.5 bg-slate-50 hover:bg-[#5b93c8]/10 border border-slate-200 hover:border-[#5b93c8] rounded-[16px] transition-colors text-left flex items-center justify-between group cursor-pointer"
                >
                  <div className="truncate mr-2">
                    <div className="text-xs font-bold text-slate-950 group-hover:text-[#5b93c8] truncate">
                      {q.avatarName}
                    </div>
                    {showAvatarSubtitles && (
                      <div className="text-[11px] text-slate-900 line-clamp-1 mt-0.5">
                        {q.questionText}
                      </div>
                    )}
                  </div>

                  <span className="px-2.5 py-1 bg-[#5b93c8] text-white rounded-[8px] text-[11px] font-bold shrink-0">
                    指名
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : activeQuestion ? (
          <div className="p-4 sm:p-5 bg-white/95 backdrop-blur-md border border-white/90 rounded-[22px] shadow-[0_10px_28px_0_rgba(15,23,42,0.16)] space-y-3">
            {/* Real-time Oscilloscope Waveform Visualizer */}
            <div className="px-4 py-2.5 bg-slate-900 rounded-[14px] flex items-center gap-3">
              <Mic
                className={`w-4 h-4 shrink-0 ${
                  interimAnswer ? 'text-[#5bc8ac]' : 'text-[#5b93c8]'
                }`}
              />
              <div className="flex-1 h-11 flex items-center">
                <canvas
                  ref={oscilloscopeCanvasRef}
                  width={520}
                  height={44}
                  className="w-full h-11 block"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={handleForceResolve}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200/80 text-slate-900 hover:text-[#5b93c8] text-xs font-bold rounded-[12px] transition-colors cursor-pointer"
              >
                スキップ
              </button>
              <button
                onClick={() => {
                  setShowFinishConfirmDialog(true);
                  showFinishConfirmDialogRef.current = true;
                }}
                disabled={isEvaluatingAnswer || isAvatarSpeaking}
                className="px-5 py-2 bg-[#5b93c8] hover:bg-[#4a80b5] disabled:bg-slate-200 disabled:text-slate-700 text-white text-xs font-bold rounded-[12px] transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {isEvaluatingAnswer ? '判定中...' : '回答を終了'}
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 bg-white/95 backdrop-blur-md border border-white/90 rounded-[22px] shadow-[0_10px_28px_0_rgba(15,23,42,0.16)] flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#5bc8ac] shrink-0" />
              <span className="text-sm font-bold text-slate-950">
                質疑応答が完了しました
              </span>
            </div>

            <button
              onClick={handleFinishToReportSafe}
              className="px-5 py-2.5 bg-[#5b93c8] hover:bg-[#4a80b5] text-white text-xs font-bold rounded-[14px] transition-colors flex items-center gap-2 cursor-pointer"
            >
              <span>レポートを見る</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* 5. Answer Completion Confirmation Dialog */}
      {showFinishConfirmDialog && activeQuestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-[24px] p-6 max-w-md w-full shadow-[0_20px_50px_rgba(15,23,42,0.22)] space-y-4">
            <h3 className="text-base font-bold text-slate-950">
              回答を終了しますか？
            </h3>
            <p className="text-xs text-slate-900 leading-relaxed">
              続きを話し始めると自動でこの画面が閉じて回答を継続できます。
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowFinishConfirmDialog(false);
                  showFinishConfirmDialogRef.current = false;
                }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200/80 text-slate-900 text-xs font-bold rounded-[12px] transition-colors cursor-pointer"
              >
                回答を続ける
              </button>
              <button
                type="button"
                onClick={handleAnswerSubmit}
                disabled={isEvaluatingAnswer}
                className="px-5 py-2 bg-[#5b93c8] hover:bg-[#4a80b5] disabled:bg-slate-200 text-white text-xs font-bold rounded-[12px] transition-colors cursor-pointer"
              >
                回答を終了する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
