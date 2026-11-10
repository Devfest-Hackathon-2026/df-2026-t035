export type RoleType = 'professor' | 'peer' | 'junior';

export type GeminiVoiceName = 'Charon' | 'Fenrir' | 'Puck' | 'Kore' | 'Zephyr';

export type AvatarHairStyle = 'parted' | 'short' | 'bob' | 'long';

export type VoiceEngineMode = 'gemini' | 'browser';

export type AvatarActionType =
  | 'idle'
  | 'nod'
  | 'clap'
  | 'tilt_head'
  | 'sleep'
  | 'raised_hand'
  | 'hesitate_hand'
  | 'sneeze';

export interface HandRaiseHistoryEntry {
  prompt: string;
  topicKey?: string;
  isNegativePrompt?: boolean;
  raisedAvatarIds: string[];
  notRaisedAvatarIds: string[];
  affirmativeTrait?: string;
  negativeTrait?: string;
  timestamp: number;
}

export interface AudienceMember {
  id: string;
  name: string;
  role: RoleType;
  roleLabel: string;
  gender: 'male' | 'female';
  voiceName?: GeminiVoiceName;
  hairStyle?: AvatarHairStyle;
  clothingColor: string;
  hairColor: string;
  // User-defined or default personality, experiences, and background
  profile?: string;
  // Dynamically accumulated traits from hand-raises and interactive Q&A during the presentation
  learnedTraits?: string[];
  // Dynamic state in 3D
  currentAction: AvatarActionType;
  actionEndTime?: number;
  interestScore: number;
  understandingScore: number;
  emotion: 'Interested' | 'Impressed' | 'Confused' | 'Bored';
  hasQuestion?: boolean;
}

export interface QuestionItem {
  id: string;
  avatarId: string;
  avatarName: string;
  role: RoleType;
  questionText: string;
  isResolved: boolean;
  isSkipped?: boolean;
  isFollowUp?: boolean;
  userAnswer?: string;
  avatarFeedback?: string;
  followUpCount?: number;
}

export interface TranscriptPoint {
  time: number; // elapsed seconds
  text: string;
  interest: number;
  understanding: number;
  emotion: 'Interested' | 'Impressed' | 'Confused' | 'Bored';
  action: AvatarActionType;
  avatarId: string;
  comment?: string;
}

export interface PresentationConfig {
  timerMode: 'countdown' | 'countup';
  durationMinutes: number; // e.g. 1, 3, 5, 10
  audience: AudienceMember[]; // Up to 6 interactive front-row members
  totalAudienceCount: number; // 1 to 100 total people in the room
  showAvatarSubtitles: boolean; // Whether to display overhead text subtitles for avatar speech
  voiceEngineMode?: VoiceEngineMode; // 'gemini' (AI TTS) or 'browser' (Free Web Speech API)
  isCameraMirrored?: boolean; // Whether webcam video is horizontally mirrored
}

export interface EvaluationReport {
  overall_score: number; // 0-100
  clarity_score: number; // 0-10
  logic_score: number; // 0-10
  engagement_score: number; // 0-10
  strengths: string[];
  improvements: string[];
  next_advice: string[];
  general_comment: string;
  dip_moments?: Array<{
    timestamp: number;
    text: string;
    reason: string;
    advice: string;
  }>;
}

export type ScreenState = 'setup' | 'practice' | 'qa' | 'report';
