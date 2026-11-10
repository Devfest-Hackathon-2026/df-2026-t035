import React, { useState, useEffect, useRef } from 'react';
import {
  PresentationConfig,
  AudienceMember,
  RoleType,
  GeminiVoiceName,
  AvatarHairStyle,
  VoiceEngineMode,
} from '../types/presentation';
import { MicAudioMonitor } from '../utils/audio';
import {
  GEMINI_VOICE_OPTIONS,
  getDefaultGeminiVoice,
  speakText,
  cancelActiveSpeech,
  setGlobalVoiceEngineMode,
} from '../utils/speech';
import {
  Users,
  Clock,
  Camera,
  VideoOff,
  Mic,
  CheckCircle2,
  Play,
  Volume2,
  FlipHorizontal2,
} from 'lucide-react';

interface SetupViewProps {
  onStart: (config: PresentationConfig, mediaStream: MediaStream | null) => void;
}

const SURNAME_POOL = [
  '佐藤',
  '鈴木',
  '高橋',
  '田中',
  '伊藤',
  '渡辺',
  '山本',
  '中村',
  '小林',
  '加藤',
  '吉田',
  '山田',
  '佐々木',
  '山口',
  '松本',
  '井上',
  '木村',
  '林',
  '斎藤',
  '清水',
  '山崎',
  '森',
  '池田',
  '橋本',
];

function createShuffledSurnames(): string[] {
  const copy = [...SURNAME_POOL];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const DEFAULT_ROLES: RoleType[] = [
  'professor',
  'professor',
  'peer',
  'peer',
  'junior',
  'junior',
];

const DEFAULT_GENDERS: Array<'male' | 'female'> = [
  'male',
  'female',
  'male',
  'female',
  'male',
  'female',
];

const CLOTHING_COLORS = [
  '#1e3a8a',
  '#374151',
  '#065f46',
  '#831843',
  '#4c1d95',
  '#78350f',
];

const AUDIENCE_PRESETS = [
  { count: 1, label: '1人' },
  { count: 3, label: '3人' },
  { count: 4, label: '4人' },
  { count: 6, label: '6人' },
  { count: 15, label: '15人' },
  { count: 30, label: '30人' },
  { count: 50, label: '50人' },
  { count: 100, label: '100人' },
];

function getDefaultHairStyle(
  role: RoleType,
  gender: 'male' | 'female',
  seatIndex: number
): AvatarHairStyle {
  if (gender === 'female') {
    return role === 'professor' || seatIndex % 2 === 1 ? 'bob' : 'long';
  }
  return role === 'professor' ? 'parted' : 'short';
}

export const SetupView: React.FC<SetupViewProps> = ({ onStart }) => {
  const randomNamesRef = useRef<string[]>([...SURNAME_POOL]);
  const [totalAudienceCount, setTotalAudienceCount] = useState<number>(4);
  const interactiveCount = Math.min(6, totalAudienceCount);

  const [voiceEngineMode, setVoiceEngineMode] =
    useState<VoiceEngineMode>('gemini');
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const [audience, setAudience] = useState<AudienceMember[]>(() => {
    const names = SURNAME_POOL;
    return Array.from({ length: 4 }, (_, i) => {
      const role = DEFAULT_ROLES[i];
      const gender = DEFAULT_GENDERS[i];
      return {
        id: `avatar-${i + 1}`,
        name: names[i % names.length],
        role,
        roleLabel:
          role === 'professor'
            ? '目上/教授'
            : role === 'peer'
            ? '同輩/ゼミ生'
            : '目下/後輩',
        gender,
        voiceName: getDefaultGeminiVoice(role, gender, i),
        hairStyle: getDefaultHairStyle(role, gender, i),
        clothingColor: CLOTHING_COLORS[i % CLOTHING_COLORS.length],
        hairColor:
          role === 'professor' && gender === 'male'
            ? '#4b5563'
            : gender === 'female'
            ? '#3f2314'
            : '#1f2937',
        profile: '',
        learnedTraits: [],
        currentAction: 'idle',
        interestScore: 70,
        understandingScore: 70,
        emotion: 'Interested',
      };
    });
  });

  useEffect(() => {
    const shuffled = createShuffledSurnames();
    randomNamesRef.current = shuffled;
    setAudience((prev) =>
      prev.map((member, i) => ({
        ...member,
        name: shuffled[i % shuffled.length],
      }))
    );
  }, []);

  const [timerMode, setTimerMode] = useState<'countdown' | 'countup'>('countdown');
  const [durationMinutes, setDurationMinutes] = useState<number>(3);
  const [showAvatarSubtitles, setShowAvatarSubtitles] = useState<boolean>(false);

  const [useCamera, setUseCamera] = useState<boolean>(false);
  const [isCameraMirrored, setIsCameraMirrored] = useState<boolean>(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [deviceGranted, setDeviceGranted] = useState<boolean>(false);
  const [hasCameraTrack, setHasCameraTrack] = useState<boolean>(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState<number>(0);
  const [isRequestingDevice, setIsRequestingDevice] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const monitorRef = useRef<MicAudioMonitor | null>(null);

  useEffect(() => {
    setGlobalVoiceEngineMode(voiceEngineMode);
  }, [voiceEngineMode]);

  useEffect(() => {
    const names = randomNamesRef.current;
    setAudience((prev) => {
      const next: AudienceMember[] = [];
      for (let i = 0; i < interactiveCount; i++) {
        if (prev[i]) {
          next.push(prev[i]);
        } else {
          const role = DEFAULT_ROLES[i % DEFAULT_ROLES.length];
          const gender = DEFAULT_GENDERS[i % DEFAULT_GENDERS.length];
          next.push({
            id: `avatar-${i + 1}`,
            name: names[i % names.length],
            role,
            roleLabel:
              role === 'professor'
                ? '目上/教授'
                : role === 'peer'
                ? '同輩/ゼミ生'
                : '目下/後輩',
            gender,
            voiceName: getDefaultGeminiVoice(role, gender, i),
            hairStyle: getDefaultHairStyle(role, gender, i),
            clothingColor: CLOTHING_COLORS[i % CLOTHING_COLORS.length],
            hairColor:
              role === 'professor' && gender === 'male'
                ? '#4b5563'
                : gender === 'female'
                ? '#3f2314'
                : '#1f2937',
            profile: '',
            learnedTraits: [],
            currentAction: 'idle',
            interestScore: 70,
            understandingScore: 70,
            emotion: 'Interested',
          });
        }
      }
      return next;
    });
  }, [interactiveCount]);

  const requestMedia = async (withCamera: boolean) => {
    setIsRequestingDevice(true);
    setDeviceError(null);
    setUseCamera(withCamera);

    // Stop any previous video tracks if switching to camera-off
    if (!withCamera && stream) {
      stream.getVideoTracks().forEach((t) => {
        t.stop();
        stream.removeTrack(t);
      });
      setHasCameraTrack(false);
    }

    try {
      const userStream = await navigator.mediaDevices.getUserMedia({
        video: withCamera
          ? { width: { ideal: 640 }, height: { ideal: 480 } }
          : false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      setStream(userStream);
      setDeviceGranted(true);
      const videoActive = userStream.getVideoTracks().length > 0;
      setHasCameraTrack(videoActive);

      if (videoRef.current) {
        videoRef.current.srcObject = videoActive ? userStream : null;
        if (videoActive) {
          videoRef.current.play().catch(() => {});
        }
      }

      if (!monitorRef.current) {
        monitorRef.current = new MicAudioMonitor((lvl) => {
          setMicLevel(lvl);
        });
      }
      monitorRef.current.start(userStream);
    } catch (err: any) {
      console.warn('getUserMedia error:', err);
      try {
        const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        setStream(audioOnlyStream);
        setDeviceGranted(true);
        setHasCameraTrack(false);
        setUseCamera(false);
        if (!monitorRef.current) {
          monitorRef.current = new MicAudioMonitor((lvl) => {
            setMicLevel(lvl);
          });
        }
        monitorRef.current.start(audioOnlyStream);
      } catch {
        setDeviceError(
          'マイクまたはカメラが接続されていないか許可されていません（このままカメラなしで開始することも可能です）。'
        );
        setHasCameraTrack(false);
      }
    } finally {
      setIsRequestingDevice(false);
    }
  };

  const handleToggleCamera = (enableCamera: boolean) => {
    setUseCamera(enableCamera);
    if (!enableCamera && stream) {
      stream.getVideoTracks().forEach((t) => {
        t.stop();
        stream.removeTrack(t);
      });
      setHasCameraTrack(false);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    } else if (enableCamera && deviceGranted && !hasCameraTrack) {
      requestMedia(true);
    }
  };

  useEffect(() => {
    return () => {
      cancelActiveSpeech();
      if (monitorRef.current) {
        monitorRef.current.stop();
      }
    };
  }, []);

  const updateAudienceMember = (
    index: number,
    field: 'name' | 'role' | 'gender' | 'voiceName' | 'profile',
    value: string
  ) => {
    setAudience((prev) => {
      const clone = [...prev];
      const current = clone[index];
      if (!current) return prev;

      if (field === 'role') {
        const role = value as RoleType;
        const nextVoice = getDefaultGeminiVoice(role, current.gender, index);
        clone[index] = {
          ...current,
          role,
          roleLabel:
            role === 'professor'
              ? '目上/教授'
              : role === 'peer'
              ? '同輩/ゼミ生'
              : '目下/後輩',
          voiceName: nextVoice,
          hairStyle: getDefaultHairStyle(role, current.gender, index),
          hairColor:
            role === 'professor' && current.gender === 'male'
              ? '#4b5563'
              : current.gender === 'female'
              ? '#3f2314'
              : '#1f2937',
        };
      } else if (field === 'gender') {
        const gender = value as 'male' | 'female';
        const nextVoice = getDefaultGeminiVoice(current.role, gender, index);
        clone[index] = {
          ...current,
          gender,
          voiceName: nextVoice,
          hairStyle: getDefaultHairStyle(current.role, gender, index),
          hairColor:
            current.role === 'professor' && gender === 'male'
              ? '#4b5563'
              : gender === 'female'
              ? '#3f2314'
              : '#1f2937',
        };
      } else if (field === 'voiceName') {
        const voiceName = value as GeminiVoiceName;
        const opt = GEMINI_VOICE_OPTIONS.find((v) => v.id === voiceName);
        const nextGender = opt ? opt.gender : current.gender;
        clone[index] = {
          ...current,
          voiceName,
          gender: nextGender,
          hairStyle: getDefaultHairStyle(current.role, nextGender, index),
        };
      } else if (field === 'profile') {
        clone[index] = {
          ...current,
          profile: value,
        };
      } else {
        clone[index] = {
          ...current,
          name: value,
        };
      }
      return clone;
    });
  };

  const handlePreviewVoice = (member: AudienceMember) => {
    if (previewingId === member.id) {
      cancelActiveSpeech();
      setPreviewingId(null);
      return;
    }

    const cleanShortName = member.name.replace(/[\s(（].*$/, '').trim() || '聴衆';
    const samplePhrase =
      member.role === 'professor'
        ? `こんにちは、${cleanShortName}です。本日の発表を楽しみにしています。`
        : member.role === 'junior'
        ? `こんにちは！${cleanShortName}です。しっかり勉強させていただきます！`
        : `こんにちは、${cleanShortName}です。よろしくお願いします！`;

    setPreviewingId(member.id);
    speakText(
      samplePhrase,
      member.role,
      member.gender,
      () => {},
      () => {
        setPreviewingId((prev) => (prev === member.id ? null : prev));
      },
      {
        voiceName: member.voiceName,
        avatarId: member.id,
        forceEngine: voiceEngineMode,
      }
    );
  };

  const handleStart = async () => {
    cancelActiveSpeech();
    setGlobalVoiceEngineMode(voiceEngineMode);

    if (monitorRef.current) {
      monitorRef.current.stop();
    }

    const isAndroid =
      typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

    let activeStream = stream;

    if (isAndroid) {
      // Android版Chromeでは、getUserMediaの音声トラック（audio）を掴んだままだと
      // OSの排他ロックにより SpeechRecognition（音声認識）がマイクにアクセスできなくなるため、
      // プレゼン開始前に音声トラックを必ず解放し、カメラON時のみ映像トラックだけを取得する
      if (activeStream) {
        activeStream.getAudioTracks().forEach((t) => {
          t.stop();
          activeStream?.removeTrack(t);
        });
        if (!useCamera) {
          activeStream.getVideoTracks().forEach((t) => {
            t.stop();
            activeStream?.removeTrack(t);
          });
          activeStream = null;
        }
      }
      if (
        useCamera &&
        (!activeStream || activeStream.getVideoTracks().length === 0)
      ) {
        try {
          activeStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false,
          });
        } catch {
          activeStream = null;
        }
      }
    } else if (!activeStream) {
      try {
        activeStream = await navigator.mediaDevices.getUserMedia({
          video: useCamera
            ? { width: { ideal: 640 }, height: { ideal: 480 } }
            : false,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        try {
          activeStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        } catch {
          activeStream = null;
        }
      }
    } else if (!useCamera) {
      activeStream.getVideoTracks().forEach((t) => {
        t.stop();
        activeStream?.removeTrack(t);
      });
    }

    onStart(
      {
        timerMode,
        durationMinutes,
        audience,
        totalAudienceCount,
        showAvatarSubtitles,
        voiceEngineMode,
        isCameraMirrored,
      },
      activeStream
    );
  };

  return (
    <div className="min-h-[calc(100vh-4.5rem)] bg-[#f6f9fc] text-slate-950 px-4 sm:px-6 py-6 sm:py-8">
      <div className="max-w-5xl mx-auto w-full space-y-6">
        {/* Main 12-Column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Presentation & Audience Settings (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Section 1: Audience Settings */}
            <section className="p-6 bg-white rounded-[24px] shadow-[0_8px_24px_0_rgba(15,23,42,0.04)] border border-slate-200 space-y-6">
              <div className="yondec-headline">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-[10px] bg-[#5b93c8]/15 text-[#5b93c8] flex items-center justify-center">
                    <Users className="w-4 h-4" />
                  </div>
                  <h2 className="text-base font-bold text-slate-950 tracking-tight">
                    オーディエンスの設定
                  </h2>
                </div>
              </div>

              {/* Audience Count */}
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-bold text-slate-950">
                    人数
                  </span>
                  <div className="text-lg font-extrabold text-[#5b93c8] tabular-nums">
                    {totalAudienceCount}
                    <span className="text-xs font-bold text-slate-900 ml-1">
                      人
                    </span>
                  </div>
                </div>

                {/* Quick Presets (1, 3, 4, 6, 15, 30, 50, 100) */}
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                  {AUDIENCE_PRESETS.map((preset) => {
                    const isSelected = totalAudienceCount === preset.count;
                    return (
                      <button
                        key={preset.count}
                        type="button"
                        onClick={() => setTotalAudienceCount(preset.count)}
                        className={`py-1.5 px-2 text-xs rounded-[10px] border transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-[#5b93c8] border-[#5b93c8] text-white font-bold'
                            : 'bg-slate-50 border-slate-200 text-slate-900 hover:border-[#5b93c8] font-semibold'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                {/* Slider */}
                <input
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  value={totalAudienceCount}
                  onChange={(e) =>
                    setTotalAudienceCount(parseInt(e.target.value, 10))
                  }
                  className="w-full accent-[#5b93c8] cursor-pointer h-2 bg-slate-200 rounded-lg"
                />
              </div>

              {/* Voice Engine Selector */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-950">
                  音声合成エンジン
                </span>
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-[12px] w-full sm:w-72">
                  <button
                    type="button"
                    onClick={() => setVoiceEngineMode('gemini')}
                    className={`flex-1 py-1.5 text-xs rounded-[9px] transition-colors cursor-pointer ${
                      voiceEngineMode === 'gemini'
                        ? 'bg-[#5b93c8] text-white font-bold'
                        : 'text-slate-900 hover:text-[#5b93c8] font-semibold'
                    }`}
                  >
                    Neural2ボイス
                  </button>
                  <button
                    type="button"
                    onClick={() => setVoiceEngineMode('browser')}
                    className={`flex-1 py-1.5 text-xs rounded-[9px] transition-colors cursor-pointer ${
                      voiceEngineMode === 'browser'
                        ? 'bg-[#5b93c8] text-white font-bold'
                        : 'text-slate-900 hover:text-[#5b93c8] font-semibold'
                    }`}
                  >
                    ブラウザ内蔵
                  </button>
                </div>
              </div>

              {/* Individual Avatar Settings */}
              <div className="pt-2 border-t border-slate-100 space-y-3">
                <div className="text-xs font-bold text-slate-950">
                  アバター個別設定
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                  {audience.map((member, idx) => {
                    const isPreviewing = previewingId === member.id;
                    return (
                      <div
                        key={member.id}
                        className="min-w-0 overflow-hidden p-3.5 bg-slate-50 border border-slate-200 rounded-[16px] space-y-2.5"
                      >
                        {/* Row 1: Seat # + Gender Toggle + Role Select */}
                        <div className="flex items-center justify-between gap-1.5 min-w-0">
                          <span className="text-xs text-[#5b93c8] font-bold shrink-0">
                            #{idx + 1}
                          </span>

                          <div className="flex items-center gap-0.5 bg-white border border-slate-200 rounded-[8px] p-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                updateAudienceMember(idx, 'gender', 'male')
                              }
                              className={`px-2 py-0.5 text-[10px] font-bold rounded-[6px] transition-colors cursor-pointer ${
                                member.gender === 'male'
                                  ? 'bg-[#5b93c8] text-white'
                                  : 'text-slate-900 hover:text-[#5b93c8]'
                              }`}
                            >
                              男性
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateAudienceMember(idx, 'gender', 'female')
                              }
                              className={`px-2 py-0.5 text-[10px] font-bold rounded-[6px] transition-colors cursor-pointer ${
                                member.gender === 'female'
                                  ? 'bg-[#5b93c8] text-white'
                                  : 'text-slate-900 hover:text-[#5b93c8]'
                              }`}
                            >
                              女性
                            </button>
                          </div>

                          <select
                            value={member.role}
                            onChange={(e) =>
                              updateAudienceMember(idx, 'role', e.target.value)
                            }
                            className="min-w-0 flex-1 text-xs bg-white border border-slate-200 text-slate-950 font-semibold rounded-[8px] px-2 py-1 truncate outline-none focus:border-[#5b93c8]"
                          >
                            <option value="professor">目上/教授</option>
                            <option value="peer">同輩/ゼミ生</option>
                            <option value="junior">目下/後輩</option>
                          </select>
                        </div>

                        {/* Row 2: Name Input */}
                        <input
                          type="text"
                          value={member.name}
                          onChange={(e) =>
                            updateAudienceMember(idx, 'name', e.target.value)
                          }
                          placeholder="名前"
                          className="w-full min-w-0 text-xs bg-white border border-slate-200 focus:border-[#5b93c8] rounded-[10px] px-3 py-1.5 text-slate-950 font-semibold outline-none"
                        />

                        {/* Row 2.5: Personality / Experience / Background Free-Text Input */}
                        <input
                          type="text"
                          value={member.profile || ''}
                          onChange={(e) =>
                            updateAudienceMember(idx, 'profile', e.target.value)
                          }
                          placeholder="性格・経験・背景（例: パスポート所持、海外旅行好き）"
                          className="w-full min-w-0 text-[11px] bg-white border border-slate-200 focus:border-[#5b93c8] rounded-[10px] px-3 py-1.5 text-slate-950 font-medium outline-none"
                        />

                        {/* Row 3: Voice Selector + Preview Button */}
                        <div className="flex items-center gap-1.5 min-w-0 w-full">
                          <select
                            value={
                              member.voiceName ||
                              getDefaultGeminiVoice(
                                member.role,
                                member.gender,
                                idx
                              )
                            }
                            onChange={(e) =>
                              updateAudienceMember(
                                idx,
                                'voiceName',
                                e.target.value
                              )
                            }
                            className="min-w-0 w-0 flex-1 text-[11px] bg-white border border-slate-200 text-slate-950 font-medium rounded-[8px] px-2 py-1 truncate outline-none focus:border-[#5b93c8]"
                          >
                            {GEMINI_VOICE_OPTIONS.map((vo) => (
                              <option key={vo.id} value={vo.id}>
                                {vo.label}
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            onClick={() => handlePreviewVoice(member)}
                            className={`px-2.5 py-1 rounded-[8px] text-[11px] font-bold border flex items-center gap-1 shrink-0 transition-colors cursor-pointer ${
                              isPreviewing
                                ? 'bg-[#5bc8ac] text-white border-[#5bc8ac]'
                                : 'bg-white hover:bg-[#5b93c8]/10 text-[#5b93c8] border-[#5b93c8]/40'
                            }`}
                          >
                            <Volume2 className="w-3 h-3 shrink-0" />
                            <span>{isPreviewing ? '停止' : '試聴'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Section 2: Timer & Subtitles */}
            <section className="p-6 bg-white rounded-[24px] shadow-[0_8px_24px_0_rgba(15,23,42,0.04)] border border-slate-200 space-y-5">
              <div className="yondec-headline">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-[10px] bg-[#5bc8ac]/15 text-[#5bc8ac] flex items-center justify-center">
                    <Clock className="w-4 h-4" />
                  </div>
                  <h2 className="text-base font-bold text-slate-950 tracking-tight">
                    タイマー・表示設定
                  </h2>
                </div>
              </div>

              {/* Timer Mode */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-950">
                  タイマー方式
                </span>
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-[12px] w-full sm:w-64">
                  <button
                    type="button"
                    onClick={() => setTimerMode('countdown')}
                    className={`flex-1 py-1.5 text-xs rounded-[9px] transition-colors cursor-pointer ${
                      timerMode === 'countdown'
                        ? 'bg-[#5b93c8] text-white font-bold'
                        : 'text-slate-900 hover:text-[#5b93c8] font-semibold'
                    }`}
                  >
                    カウントダウン
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimerMode('countup')}
                    className={`flex-1 py-1.5 text-xs rounded-[9px] transition-colors cursor-pointer ${
                      timerMode === 'countup'
                        ? 'bg-[#5b93c8] text-white font-bold'
                        : 'text-slate-900 hover:text-[#5b93c8] font-semibold'
                    }`}
                  >
                    カウントアップ
                  </button>
                </div>
              </div>

              {/* Duration Minutes */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor="duration-minutes-input"
                    className="text-xs font-bold text-slate-950"
                  >
                    持ち時間
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="duration-minutes-input"
                      type="number"
                      min={1}
                      max={180}
                      step={1}
                      value={durationMinutes}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!Number.isNaN(val)) {
                          setDurationMinutes(Math.max(1, Math.min(180, val)));
                        }
                      }}
                      className="w-18 text-right text-sm font-bold text-[#5b93c8] bg-slate-50 border border-slate-200 focus:border-[#5b93c8] rounded-[10px] px-2.5 py-1 outline-none tabular-nums"
                    />
                    <span className="text-xs font-bold text-slate-950">
                      分
                    </span>
                  </div>
                </div>

                <input
                  type="range"
                  min="1"
                  max="60"
                  step="1"
                  value={Math.min(60, durationMinutes)}
                  onChange={(e) =>
                    setDurationMinutes(parseInt(e.target.value, 10))
                  }
                  className="w-full accent-[#5b93c8] cursor-pointer h-2 bg-slate-200 rounded-lg"
                />

                <div className="flex items-center gap-1.5 flex-wrap">
                  {[1, 3, 5, 7, 10, 15, 20, 30].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => setDurationMinutes(mins)}
                      className={`px-2.5 py-1 text-xs rounded-[9px] border transition-colors cursor-pointer ${
                        durationMinutes === mins
                          ? 'bg-[#5b93c8] border-[#5b93c8] text-white font-bold'
                          : 'bg-slate-50 border-slate-200 text-slate-900 hover:border-[#5b93c8] font-semibold'
                      }`}
                    >
                      {mins}分
                    </button>
                  ))}
                </div>
              </div>

              {/* Avatar Subtitles Toggle */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-950">
                  アバターの吹き出しの表示
                </span>
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-[12px] w-full sm:w-64">
                  <button
                    type="button"
                    onClick={() => setShowAvatarSubtitles(false)}
                    className={`flex-1 py-1.5 text-xs rounded-[9px] transition-colors cursor-pointer ${
                      !showAvatarSubtitles
                        ? 'bg-[#5b93c8] text-white font-bold'
                        : 'text-slate-900 hover:text-[#5b93c8] font-semibold'
                    }`}
                  >
                    非表示
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAvatarSubtitles(true)}
                    className={`flex-1 py-1.5 text-xs rounded-[9px] transition-colors cursor-pointer ${
                      showAvatarSubtitles
                        ? 'bg-[#5b93c8] text-white font-bold'
                        : 'text-slate-900 hover:text-[#5b93c8] font-semibold'
                    }`}
                  >
                    表示する
                  </button>
                </div>
              </div>
            </section>
          </div>

          {/* Right Column: Device Verification & Start Button (5 cols) */}
          <div className="lg:col-span-5 lg:sticky lg:top-6 space-y-5">
            <div className="p-6 bg-white rounded-[24px] shadow-[0_8px_24px_0_rgba(15,23,42,0.04)] border border-slate-200 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-[10px] bg-[#5b93c8]/15 text-[#5b93c8] flex items-center justify-center">
                    <Mic className="w-4 h-4" />
                  </div>
                  <h2 className="text-base font-bold text-slate-950 tracking-tight">
                    マイク・カメラ設定
                  </h2>
                </div>
                {deviceGranted && (
                  <span className="inline-flex items-center gap-1 text-xs text-[#5bc8ac] font-bold">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{hasCameraTrack ? 'カメラ・マイク接続済' : 'マイク接続済'}</span>
                  </span>
                )}
              </div>

              {/* Camera Usage Toggle */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-950">
                  カメラの使用
                </span>
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-[12px] w-52">
                  <button
                    type="button"
                    onClick={() => handleToggleCamera(false)}
                    className={`flex-1 py-1.5 text-xs rounded-[9px] transition-colors cursor-pointer ${
                      !useCamera
                        ? 'bg-[#5b93c8] text-white font-bold'
                        : 'text-slate-900 hover:text-[#5b93c8] font-semibold'
                    }`}
                  >
                    使用しない
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleCamera(true)}
                    className={`flex-1 py-1.5 text-xs rounded-[9px] transition-colors cursor-pointer ${
                      useCamera
                        ? 'bg-[#5b93c8] text-white font-bold'
                        : 'text-slate-900 hover:text-[#5b93c8] font-semibold'
                    }`}
                  >
                    使用する
                  </button>
                </div>
              </div>

              {/* Video or Camera-Off Preview Box */}
              <div className="relative aspect-video bg-slate-900 border border-slate-200 rounded-[18px] overflow-hidden flex items-center justify-center">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover transition-transform duration-150 ${
                    isCameraMirrored ? '-scale-x-100' : ''
                  } ${useCamera && hasCameraTrack ? 'block' : 'hidden'}`}
                />

                {useCamera && (
                  <button
                    type="button"
                    onClick={() => setIsCameraMirrored((prev) => !prev)}
                    className="absolute top-2.5 right-2.5 z-10 px-2.5 py-1.5 rounded-[10px] bg-slate-900/80 hover:bg-slate-900 text-white border border-white/25 text-[11px] font-bold flex items-center gap-1.5 backdrop-blur-sm transition-colors cursor-pointer"
                    title="カメラ映像の左右反転を切り替え（スライド投影時など）"
                  >
                    <FlipHorizontal2 className="w-3.5 h-3.5 text-[#5bc8ac]" />
                    <span>{isCameraMirrored ? '左右反転: ON' : '左右反転: OFF'}</span>
                  </button>
                )}

                {(!useCamera || !hasCameraTrack) && (
                  <div className="text-center p-5 space-y-3">
                    <div className="w-11 h-11 mx-auto rounded-2xl bg-white/15 flex items-center justify-center text-white">
                      {useCamera ? (
                        <Camera className="w-5 h-5" />
                      ) : (
                        <VideoOff className="w-5 h-5" />
                      )}
                    </div>
                    <div className="text-xs font-bold text-white">
                      {useCamera
                        ? 'カメラとマイクをテストできます'
                        : deviceGranted
                        ? 'カメラなし（マイクのみ）で準備完了'
                        : 'カメラを使用せずにプレゼンを開始できます'}
                    </div>
                    <button
                      type="button"
                      onClick={() => requestMedia(useCamera)}
                      disabled={isRequestingDevice}
                      className="px-4 py-2 text-xs font-bold text-white bg-[#5b93c8] hover:bg-[#4a80b5] rounded-[12px] transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {isRequestingDevice
                        ? '確認中...'
                        : useCamera
                        ? 'カメラ・マイクをテストする'
                        : deviceGranted
                        ? 'マイクを再テストする'
                        : 'マイク入力をテストする（任意）'}
                    </button>
                  </div>
                )}
              </div>

              {/* Mic VU Level Meter */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-bold text-slate-950">
                    <Mic className="w-3.5 h-3.5 text-[#5b93c8]" />
                    <span>マイク入力</span>
                  </span>
                  <span className="font-bold text-slate-950 tabular-nums">
                    {micLevel}%
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-75 ${
                      micLevel > 15 ? 'bg-[#5bc8ac]' : 'bg-[#5b93c8]'
                    }`}
                    style={{ width: `${micLevel}%` }}
                  />
                </div>
              </div>

              {deviceError && (
                <div className="p-3 text-xs bg-slate-100 border border-slate-300 text-slate-950 rounded-[12px] font-semibold">
                  {deviceError}
                </div>
              )}

              {/* Start CTA Button (Always enabled — works with or without camera) */}
              <button
                type="button"
                onClick={handleStart}
                className="w-full py-3.5 px-6 rounded-[14px] font-bold text-sm flex items-center justify-center gap-2 transition-colors bg-[#5b93c8] hover:bg-[#4a80b5] text-white cursor-pointer shadow-sm"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>プレゼンを開始</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
