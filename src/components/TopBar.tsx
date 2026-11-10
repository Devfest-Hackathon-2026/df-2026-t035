import React from 'react';
import { ScreenState } from '../types/presentation';
import { RotateCcw } from 'lucide-react';

interface TopBarProps {
  currentScreen: ScreenState;
  onReset: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ currentScreen, onReset }) => {
  const steps: { key: ScreenState; label: string; num: string }[] = [
    { key: 'setup', label: '設定', num: '01' },
    { key: 'practice', label: 'プレゼン練習', num: '02' },
    { key: 'qa', label: '質疑応答', num: '03' },
    { key: 'report', label: 'レポート', num: '04' },
  ];

  const isStageView = currentScreen === 'practice' || currentScreen === 'qa';

  return (
    <header
      className={`w-full z-30 shrink-0 transition-colors duration-300 no-print ${
        isStageView
          ? 'bg-white/95 backdrop-blur-md border-b border-slate-200'
          : 'pt-3 pb-1 px-4 sm:px-6 bg-transparent'
      }`}
    >
      <div
        className={`mx-auto flex items-center justify-between gap-6 ${
          isStageView
            ? 'h-14 max-w-7xl px-4 sm:px-6'
            : 'h-14 max-w-5xl px-5 sm:px-7 rounded-[20px] bg-white/95 backdrop-blur-md shadow-[0_8px_24px_0_rgba(15,23,42,0.06)] border border-slate-200'
        }`}
      >
        {/* Zone 1: Brand Wordmark ("Preプレ" — gradient used ONLY on the logo icon as per policy) */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div
            className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-[#5b93c8] to-[#5bc8ac] flex items-center justify-center shadow-sm"
            aria-hidden="true"
          >
            <span className="text-xs font-extrabold text-white tracking-tighter">
              P
            </span>
          </div>
          <span className="text-lg font-extrabold tracking-tight text-slate-950 whitespace-nowrap">
            Pre<span className="text-[#5b93c8]">プレ</span>
          </span>
        </div>

        {/* Zone 2: 4-Step Navigation */}
        <nav className="hidden md:flex items-center gap-8 text-xs font-medium h-full">
          {steps.map((step) => {
            const isActive = currentScreen === step.key;
            const isPassed =
              (step.key === 'setup' && currentScreen !== 'setup') ||
              (step.key === 'practice' &&
                (currentScreen === 'qa' || currentScreen === 'report')) ||
              (step.key === 'qa' && currentScreen === 'report');

            return (
              <div
                key={step.key}
                className={`relative h-full flex items-center transition-colors whitespace-nowrap ${
                  isActive
                    ? 'text-slate-950 font-bold'
                    : isPassed
                    ? 'text-[#5b93c8] font-bold'
                    : 'text-slate-900'
                }`}
              >
                <span className="text-[11px] mr-1.5 text-[#5b93c8] font-bold">
                  {step.num}
                </span>
                <span>{step.label}</span>
                {isActive && (
                  <span
                    className="absolute bottom-0 left-0 right-0 h-[3px] rounded-full bg-[#5b93c8]"
                    aria-hidden="true"
                  />
                )}
                {isPassed && !isActive && (
                  <span
                    className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-[#5bc8ac]"
                    aria-hidden="true"
                  />
                )}
              </div>
            );
          })}
        </nav>

        {/* Zone 3: Reset Action */}
        <div className="flex items-center justify-end min-w-[120px] shrink-0">
          {currentScreen !== 'setup' && (
            <button
              onClick={onReset}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-slate-900 hover:text-[#5b93c8] bg-slate-100 hover:bg-[#5b93c8]/10 rounded-[12px] transition-colors whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>最初からやり直す</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
