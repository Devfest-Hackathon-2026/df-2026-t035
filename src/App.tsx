'use client';

import React, { useState } from 'react';
import {
  ScreenState,
  PresentationConfig,
  TranscriptPoint,
  QuestionItem,
} from './types/presentation';
import { TopBar } from './components/TopBar';
import { SetupView } from './components/SetupView';
import { PracticeView } from './components/PracticeView';
import { QAView } from './components/QAView';
import { ReportView } from './components/ReportView';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenState>('setup');

  // Presentation configuration
  const [config, setConfig] = useState<PresentationConfig | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  // Practice session results
  const [transcript, setTranscript] = useState<TranscriptPoint[]>([]);
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [durationSeconds, setDurationSeconds] = useState<number>(0);

  // Transition from Setup (Screen 1) -> Practice (Screen 2)
  const handleStartPractice = (
    newConfig: PresentationConfig,
    stream: MediaStream | null
  ) => {
    setConfig(newConfig);
    setMediaStream(stream);
    setTranscript([]);
    setQuestions([]);
    setDurationSeconds(0);
    setCurrentScreen('practice');
  };

  // Transition from Practice (Screen 2) -> QA (Screen 3)
  const handleFinishToQA = (
    recordedTranscript: TranscriptPoint[],
    accumulatedQuestions: QuestionItem[],
    elapsedSeconds: number,
    updatedShowAvatarSubtitles: boolean
  ) => {
    setTranscript(recordedTranscript);
    setQuestions(accumulatedQuestions);
    setDurationSeconds(elapsedSeconds);
    setConfig((prev) =>
      prev
        ? { ...prev, showAvatarSubtitles: updatedShowAvatarSubtitles }
        : prev
    );
    setCurrentScreen('qa');
  };

  // Transition from QA (Screen 3) -> Report (Screen 4)
  const handleFinishToReport = (
    resolvedQuestions: QuestionItem[],
    finalTranscript: TranscriptPoint[]
  ) => {
    setQuestions(resolvedQuestions);
    setTranscript(finalTranscript);
    setCurrentScreen('report');
  };

  // Reset back to Setup
  const handleReset = () => {
    setCurrentScreen('setup');
  };

  return (
    <div className="min-h-screen bg-[#f6f9fc] text-slate-950 flex flex-col selection:bg-[#5b93c8]/20 selection:text-[#2b5b84]">
      {/* Universal Top Navigation Header */}
      <TopBar currentScreen={currentScreen} onReset={handleReset} />

      {/* Main View Router */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {currentScreen === 'setup' && (
          <SetupView onStart={handleStartPractice} />
        )}

        {currentScreen === 'practice' && config && (
          <PracticeView
            config={config}
            mediaStream={mediaStream}
            onFinishToQA={handleFinishToQA}
          />
        )}

        {currentScreen === 'qa' && config && (
          <QAView
            audience={config.audience}
            totalAudienceCount={config.totalAudienceCount}
            initialShowAvatarSubtitles={config.showAvatarSubtitles}
            mediaStream={mediaStream}
            questions={questions}
            transcript={transcript}
            onFinishToReport={handleFinishToReport}
          />
        )}

        {currentScreen === 'report' && (
          <ReportView
            transcript={transcript}
            questions={questions}
            audience={config?.audience || []}
            totalAudienceCount={config?.totalAudienceCount}
            durationSeconds={durationSeconds}
            onRestart={handleReset}
          />
        )}
      </main>
    </div>
  );
}
