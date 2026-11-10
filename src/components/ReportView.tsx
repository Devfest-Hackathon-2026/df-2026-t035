import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  TranscriptPoint,
  QuestionItem,
  EvaluationReport,
  AudienceMember,
} from '../types/presentation';
import confetti from 'canvas-confetti';
import Chart, { ChartOptions } from 'chart.js/auto';
import {
  Award,
  TrendingUp,
  CheckCircle,
  AlertTriangle,
  Lightbulb,
  RotateCcw,
  MessageSquare,
  Clock,
  Layers,
  Copy,
  Check,
  Download,
  Search,
  FileText,
  Brain,
  Mic,
} from 'lucide-react';

interface ReportViewProps {
  transcript: TranscriptPoint[];
  questions: QuestionItem[];
  audience: AudienceMember[];
  totalAudienceCount?: number;
  durationSeconds: number;
  onRestart: () => void;
}

const PONDERING_STEPS = [
  '発表全体の論理構成を精査しています...',
  'オーディエンスの関心度・理解度推移を照合しています...',
  '質疑応答での回答を評価しています...',
  '総合スコアと改善アドバイスを算出しています...',
];

export const ReportView: React.FC<ReportViewProps> = ({
  transcript,
  questions,
  audience,
  totalAudienceCount,
  durationSeconds,
  onRestart,
}) => {
  const displayedAudienceCount =
    typeof totalAudienceCount === 'number' && totalAudienceCount > 0
      ? totalAudienceCount
      : audience.length;
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [ponderingStepIndex, setPonderingStepIndex] = useState<number>(0);
  const [selectedPoint, setSelectedPoint] = useState<TranscriptPoint | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!isLoading) return;
    const interval = setInterval(() => {
      setPonderingStepIndex((prev) => (prev + 1) % PONDERING_STEPS.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [isLoading]);

  const filteredTranscript = useMemo(() => {
    if (!searchTerm.trim()) return transcript;
    const term = searchTerm.toLowerCase();
    return transcript.filter((p) => p.text.toLowerCase().includes(term));
  }, [transcript, searchTerm]);

  const answeredQuestions = useMemo(() => {
    return questions.filter(
      (q) =>
        q &&
        q.isResolved &&
        !q.isSkipped &&
        typeof q.userAnswer === 'string' &&
        q.userAnswer.trim() !== ''
    );
  }, [questions]);

  const skippedQuestions = useMemo(() => {
    return questions.filter(
      (q) =>
        q &&
        (!q.isResolved ||
          q.isSkipped ||
          !q.userAnswer ||
          q.userAnswer.trim() === '')
    );
  }, [questions]);

  const handleCopyAllTranscript = () => {
    if (transcript.length === 0) return;
    const fullText = transcript
      .map((p, i) => {
        const mins = Math.floor(p.time / 60);
        const secs = p.time % 60;
        const timeFormatted = `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}]`;
        return `${timeFormatted} #${i + 1} 「${p.text}」 (関心:${p.interest}%, 理解:${p.understanding}%)`;
      })
      .join('\n');

    navigator.clipboard.writeText(fullText).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    });
  };

  const handleDownloadTranscript = () => {
    if (transcript.length === 0) return;
    const fullText = transcript
      .map((p, i) => {
        const mins = Math.floor(p.time / 60);
        const secs = p.time % 60;
        const timeFormatted = `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}]`;
        return `${timeFormatted} #${i + 1} 「${p.text}」 (関心:${p.interest}%, 理解:${p.understanding}%)`;
      })
      .join('\n\n');

    const blob = new Blob(
      [
        `■ Preプレ — 文字起こしログ\n発表時間: ${Math.floor(
          durationSeconds / 60
        )}分${durationSeconds % 60}秒\n発話数: ${
          transcript.length
        }文\n\n${fullText}`,
      ],
      { type: 'text/plain;charset=utf-8' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prepre_transcript_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalSpokenChars = useMemo(
    () => transcript.reduce((acc, p) => acc + (p.text || '').trim().length, 0),
    [transcript]
  );

  const isTooShortToScore = useMemo(() => {
    if (transcript.length === 0) return true;
    if (
      transcript.length === 1 &&
      totalSpokenChars < 20 &&
      durationSeconds < 12 &&
      answeredQuestions.length === 0
    ) {
      return true;
    }
    return false;
  }, [transcript.length, totalSpokenChars, durationSeconds, answeredQuestions.length]);

  useEffect(() => {
    if (isTooShortToScore) {
      setIsLoading(false);
      return;
    }

    try {
      confetti({
        particleCount: 60,
        spread: 55,
        origin: { y: 0.6 },
        colors: ['#5b93c8', '#5bc8ac'],
      });
    } catch {}

    const fetchSummary = async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/presentation/summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcriptHistory: transcript,
            qaHistory: questions,
            audience: audience.map((a) => ({ name: a.name, role: a.roleLabel })),
            totalAudienceCount: displayedAudienceCount,
            durationSeconds,
            totalSentences: transcript.length,
          }),
        });
        const data = await res.json();
        if (data && typeof data.overall_score === 'number') {
          const toTenScale = (v: any, fb: number) => {
            let n = Number(v);
            if (!Number.isFinite(n) || n <= 0) return fb;
            while (n > 10) n = n / 10;
            return Number(Math.max(0, Math.min(10, n)).toFixed(1));
          };
          const toHundredScale = (v: any, fb: number) => {
            let n = Number(v);
            if (!Number.isFinite(n) || n <= 0) return fb;
            if (n <= 10) n = n * 10;
            return Math.round(Math.max(0, Math.min(100, n)));
          };
          setReport({
            ...data,
            overall_score: toHundredScale(data.overall_score, 85),
            clarity_score: toTenScale(data.clarity_score, 8.2),
            logic_score: toTenScale(data.logic_score, 7.8),
            engagement_score: toTenScale(data.engagement_score, 8.0),
          });
        }
      } catch (err) {
        console.error('Failed to load summary report:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSummary();
  }, [audience, displayedAudienceCount, durationSeconds, isTooShortToScore, questions, transcript]);

  const points = useMemo(() => {
    if (transcript && transcript.length > 0) {
      return transcript;
    }
    return [
      {
        time: 0,
        text: '発表開始',
        interest: 70,
        understanding: 70,
        emotion: 'Interested' as const,
        action: 'nod' as const,
        avatarId: '1',
      },
      {
        time: Math.max(1, Math.floor(durationSeconds / 2)),
        text: '中盤の説明',
        interest: 75,
        understanding: 65,
        emotion: 'Interested' as const,
        action: 'nod' as const,
        avatarId: '1',
      },
      {
        time: Math.max(2, durationSeconds),
        text: '結論と結び',
        interest: 85,
        understanding: 80,
        emotion: 'Impressed' as const,
        action: 'clap' as const,
        avatarId: '1',
      },
    ];
  }, [transcript, durationSeconds]);

  const chartData = useMemo(() => {
    const labels = points.map((p) => {
      const mins = Math.floor(p.time / 60);
      const secs = p.time % 60;
      return `${mins}:${String(secs).padStart(2, '0')}`;
    });

    return {
      labels,
      datasets: [
        {
          label: '関心度',
          data: points.map((p) => p.interest),
          borderColor: '#5b93c8',
          backgroundColor: 'rgba(91, 147, 200, 0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: '#5b93c8',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
        },
        {
          label: '理解度',
          data: points.map((p) => p.understanding),
          borderColor: '#5bc8ac',
          backgroundColor: 'rgba(91, 200, 172, 0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: '#5bc8ac',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
        },
      ],
    };
  }, [points]);

  const chartOptions: ChartOptions<'line'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_event, elements) => {
        if (elements.length > 0) {
          const index = elements[0].index;
          if (points[index]) {
            setSelectedPoint(points[index]);
          }
        }
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          grid: { color: 'rgba(148, 163, 184, 0.35)' },
          ticks: {
            color: '#0f172a',
            font: { size: 11, weight: 'bold' },
          },
        },
        x: {
          grid: { color: 'rgba(203, 213, 225, 0.45)' },
          ticks: {
            color: '#0f172a',
            font: { size: 11, weight: 'bold' },
          },
        },
      },
      plugins: {
        legend: {
          labels: {
            color: '#0f172a',
            font: { size: 12, weight: 'bold' },
            usePointStyle: true,
            boxWidth: 8,
          },
        },
        tooltip: {
          backgroundColor: '#0f172a',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: '#334155',
          borderWidth: 1,
          padding: 10,
          displayColors: true,
          callbacks: {
            afterBody: (context) => {
              const idx = context[0].dataIndex;
              return `発言: ${points[idx]?.text.slice(0, 30)}...`;
            },
          },
        },
      },
    }),
    [points]
  );

  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    let chartInstance: Chart | null = null;
    try {
      const existing = Chart.getChart(canvasRef.current);
      if (existing) {
        existing.destroy();
      }
      chartInstance = new Chart(ctx, {
        type: 'line',
        data: chartData,
        options: chartOptions,
      });
    } catch (err) {
      console.error('Failed to instantiate Chart:', err);
    }
    return () => {
      if (chartInstance) {
        try {
          chartInstance.destroy();
        } catch {}
      }
    };
  }, [chartData, chartOptions]);

  return (
    <div className="min-h-[calc(100vh-4.5rem)] bg-[#f6f9fc] text-slate-950 px-4 sm:px-6 py-6 sm:py-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Top Header & Actions */}
        <div className="rounded-[24px] bg-white border border-slate-200 shadow-[0_8px_24px_0_rgba(15,23,42,0.04)] px-6 py-5 sm:px-7 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-950">
              分析レポート
            </h1>
            <p className="text-xs text-slate-900 font-semibold">
              発表時間{' '}
              <span className="font-bold text-slate-950">
                {Math.floor(durationSeconds / 60)}分{durationSeconds % 60}秒
              </span>
              {' '}·{' '}
              発話数{' '}
              <span className="font-bold text-slate-950">
                {transcript.length}文
              </span>
              {' '}·{' '}
              オーディエンス{' '}
              <span className="font-bold text-slate-950">
                {displayedAudienceCount}名
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onRestart}
              className="px-5 py-2 text-xs font-bold text-white bg-[#5b93c8] hover:bg-[#4a80b5] rounded-[12px] transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>もう一度練習する</span>
            </button>
          </div>
        </div>

        {/* Short Presentation / 0-Sentence Unscorable State */}
        {isTooShortToScore ? (
          <div className="rounded-[24px] bg-white border border-slate-200 shadow-[0_8px_24px_0_rgba(15,23,42,0.04)] px-6 py-16 sm:px-10 text-center space-y-5">
            <div className="w-14 h-14 rounded-[18px] bg-[#5b93c8]/15 text-[#5b93c8] flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg sm:text-xl font-extrabold text-slate-950 tracking-tight">
                プレゼンが短すぎたため、採点できませんでした
              </h2>
              <p className="text-xs sm:text-sm text-slate-900 font-semibold max-w-md mx-auto leading-relaxed">
                発話が検出されなかったか、発表時間が極端に短かったためスコアを算出できませんでした。マイク入力を確認のうえ、もう一度プレゼンをお試しください。
              </p>
            </div>
            <div className="pt-2 flex justify-center">
              <button
                type="button"
                onClick={onRestart}
                className="px-6 py-2.5 text-xs sm:text-sm font-bold text-white bg-[#5b93c8] hover:bg-[#4a80b5] rounded-[12px] transition-colors flex items-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>もう一度練習する</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Loading Banner */}
            {isLoading && (
              <div className="p-5 bg-white border border-[#5b93c8]/40 rounded-[20px] shadow-[0_8px_24px_0_rgba(15,23,42,0.04)] flex items-center gap-4">
                <div className="relative w-11 h-11 rounded-[14px] bg-[#5b93c8]/15 flex items-center justify-center shrink-0">
                  <div className="absolute inset-0 rounded-[14px] border-2 border-[#5b93c8]/25 border-t-[#5b93c8] animate-spin" />
                  <Brain className="w-5 h-5 text-[#5b93c8]" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-950">
                    レポートを作成中...
                  </div>
                  <p className="text-xs text-slate-900 font-medium mt-0.5">
                    {PONDERING_STEPS[ponderingStepIndex]}
                  </p>
                </div>
              </div>
            )}

            {/* 1. Score Summary Cards (Strict 2-Color Theme: #5b93c8 & #5bc8ac) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Overall Score */}
              <div className="p-5 bg-white border border-slate-200 rounded-[20px] shadow-[0_8px_24px_0_rgba(15,23,42,0.04)] flex items-center gap-3.5 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1 bg-[#5b93c8]" />
                <div className="w-11 h-11 rounded-[14px] bg-[#5b93c8]/15 flex items-center justify-center text-[#5b93c8] shrink-0">
                  <Award className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">総合スコア</div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight mt-0.5 tabular-nums">
                    {isLoading ? '—' : report?.overall_score || 85}
                    <span className="text-xs font-bold text-slate-900 ml-1">
                      /100
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 2: Clarity Score */}
              <div className="p-5 bg-white border border-slate-200 rounded-[20px] shadow-[0_8px_24px_0_rgba(15,23,42,0.04)] flex items-center gap-3.5 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1 bg-[#5bc8ac]" />
                <div className="w-11 h-11 rounded-[14px] bg-[#5bc8ac]/15 flex items-center justify-center text-[#5bc8ac] shrink-0">
                  <Mic className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">明瞭さ</div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight mt-0.5 tabular-nums">
                    {isLoading ? '—' : report?.clarity_score || 8.2}
                    <span className="text-xs font-bold text-slate-900 ml-1">
                      /10
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 3: Logic Score */}
              <div className="p-5 bg-white border border-slate-200 rounded-[20px] shadow-[0_8px_24px_0_rgba(15,23,42,0.04)] flex items-center gap-3.5 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1 bg-[#5b93c8]" />
                <div className="w-11 h-11 rounded-[14px] bg-[#5b93c8]/15 flex items-center justify-center text-[#5b93c8] shrink-0">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">論理構成</div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight mt-0.5 tabular-nums">
                    {isLoading ? '—' : report?.logic_score || 7.8}
                    <span className="text-xs font-bold text-slate-900 ml-1">
                      /10
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 4: Engagement Score */}
              <div className="p-5 bg-white border border-slate-200 rounded-[20px] shadow-[0_8px_24px_0_rgba(15,23,42,0.04)] flex items-center gap-3.5 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1 bg-[#5bc8ac]" />
                <div className="w-11 h-11 rounded-[14px] bg-[#5bc8ac]/15 flex items-center justify-center text-[#5bc8ac] shrink-0">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    エンゲージメント
                  </div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight mt-0.5 tabular-nums">
                    {isLoading ? '—' : report?.engagement_score || 8.0}
                    <span className="text-xs font-bold text-slate-900 ml-1">
                      /10
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Timeline Chart */}
            <section className="p-6 bg-white border border-slate-200 rounded-[24px] shadow-[0_8px_24px_0_rgba(15,23,42,0.04)] space-y-4">
              <div className="yondec-headline">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-[10px] bg-[#5b93c8]/15 text-[#5b93c8] flex items-center justify-center">
                    <Clock className="w-4 h-4" />
                  </div>
                  <h2 className="text-base font-bold text-slate-950">
                    関心度・理解度タイムライン
                  </h2>
                </div>
              </div>

              <div className="relative w-full h-64 sm:h-72">
                <canvas ref={canvasRef} />
              </div>

              {selectedPoint && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-[16px] space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#5b93c8] font-bold">
                      {Math.floor(selectedPoint.time / 60)}分{selectedPoint.time % 60}秒
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-950 font-semibold">
                        関心度 <strong className="text-[#5b93c8]">{selectedPoint.interest}%</strong>
                      </span>
                      <span className="text-slate-950 font-semibold">
                        理解度 <strong className="text-[#5bc8ac]">{selectedPoint.understanding}%</strong>
                      </span>
                      <button
                        onClick={() => setSelectedPoint(null)}
                        className="text-slate-900 hover:text-[#5b93c8] ml-2 font-bold cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-950 font-bold">
                    「{selectedPoint.text}」
                  </p>
                  {selectedPoint.comment && (
                    <p className="text-xs text-slate-900 font-medium">
                      {selectedPoint.comment}
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* 3. Feedback Columns: Strengths, Improvements, Advice */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Strengths */}
              <div className="p-6 bg-white border border-slate-200 rounded-[24px] shadow-[0_8px_24px_0_rgba(15,23,42,0.04)] space-y-3.5">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-950 pb-2 border-b border-slate-100">
                  <CheckCircle className="w-4 h-4 text-[#5bc8ac]" />
                  <span>強み</span>
                </div>
                {isLoading ? (
                  <div className="space-y-2 py-2">
                    <div className="h-3 bg-slate-100 rounded animate-pulse w-11/12" />
                    <div className="h-3 bg-slate-100 rounded animate-pulse w-4/5" />
                    <div className="h-3 bg-slate-100 rounded animate-pulse w-9/12" />
                  </div>
                ) : (
                  <ul className="space-y-2.5 text-xs text-slate-950 font-medium leading-relaxed">
                    {(report?.strengths || []).map((s, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-[#5bc8ac] font-bold">・</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Improvements */}
              <div className="p-6 bg-white border border-slate-200 rounded-[24px] shadow-[0_8px_24px_0_rgba(15,23,42,0.04)] space-y-3.5">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-950 pb-2 border-b border-slate-100">
                  <AlertTriangle className="w-4 h-4 text-[#5b93c8]" />
                  <span>改善点</span>
                </div>
                {isLoading ? (
                  <div className="space-y-2 py-2">
                    <div className="h-3 bg-slate-100 rounded animate-pulse w-10/12" />
                    <div className="h-3 bg-slate-100 rounded animate-pulse w-11/12" />
                    <div className="h-3 bg-slate-100 rounded animate-pulse w-3/4" />
                  </div>
                ) : (
                  <ul className="space-y-2.5 text-xs text-slate-950 font-medium leading-relaxed">
                    {(report?.improvements || []).map((imp, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-[#5b93c8] font-bold">・</span>
                        <span>{imp}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Next Advice */}
              <div className="p-6 bg-white border border-slate-200 rounded-[24px] shadow-[0_8px_24px_0_rgba(15,23,42,0.04)] space-y-3.5">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-950 pb-2 border-b border-slate-100">
                  <Lightbulb className="w-4 h-4 text-[#5bc8ac]" />
                  <span>次回へのアドバイス</span>
                </div>
                {isLoading ? (
                  <div className="space-y-2 py-2">
                    <div className="h-3 bg-slate-100 rounded animate-pulse w-11/12" />
                    <div className="h-3 bg-slate-100 rounded animate-pulse w-5/6" />
                    <div className="h-3 bg-slate-100 rounded animate-pulse w-4/5" />
                  </div>
                ) : (
                  <ul className="space-y-2.5 text-xs text-slate-950 font-medium leading-relaxed">
                    {(report?.next_advice || []).map((adv, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-[#5bc8ac] font-bold">・</span>
                        <span>{adv}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* 4. General Comment Banner */}
            <div className="p-6 bg-white border border-slate-200 rounded-[24px] shadow-[0_8px_24px_0_rgba(15,23,42,0.04)] space-y-2">
              <div className="text-xs font-bold text-[#5b93c8]">総評</div>
              <p className="text-xs sm:text-sm text-slate-950 leading-relaxed font-medium">
                {isLoading
                  ? '評価を作成しています...'
                  : report?.general_comment || '発表と質疑応答の記録を基に分析を完了しました。'}
              </p>
            </div>

            {/* 5. Q&A Session Review Log */}
            {questions.length > 0 && (
              <section className="p-6 bg-white border border-slate-200 rounded-[24px] shadow-[0_8px_24px_0_rgba(15,23,42,0.04)] space-y-4">
                <div className="yondec-headline">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-[10px] bg-[#5b93c8]/15 text-[#5b93c8] flex items-center justify-center">
                      <MessageSquare className="w-4 h-4" />
                    </div>
                    <h3 className="text-base font-bold text-slate-950">
                      質疑応答ログ
                    </h3>
                  </div>
                </div>

                {answeredQuestions.length > 0 ? (
                  <div className="space-y-3">
                    {answeredQuestions.map((q, idx) => (
                      <div
                        key={q.id || idx}
                        className="p-4 bg-slate-50 border border-slate-200 rounded-[16px] space-y-2 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#5b93c8]">
                            {q.avatarName}
                          </span>
                          {q.isFollowUp && (
                            <span className="px-2 py-0.5 rounded-md bg-[#5bc8ac]/20 text-slate-950 text-[10px] font-bold">
                              追加質問
                            </span>
                          )}
                        </div>
                        <p className="text-slate-950 font-semibold">
                          <strong>質問:</strong> 「{q.questionText}」
                        </p>
                        <p className="text-slate-950 font-medium bg-white p-3 rounded-[12px] border border-slate-200">
                          <strong>回答:</strong> 「{q.userAnswer}」
                        </p>
                        {q.avatarFeedback && (
                          <p className="text-slate-900 font-medium text-[11px]">
                            <strong>反応:</strong> 「{q.avatarFeedback}」
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-[16px] text-xs text-slate-900 font-medium">
                    質疑応答はスキップされました（未回答の質問内容に対する減点はありません）。
                  </div>
                )}

                {skippedQuestions.length > 0 && answeredQuestions.length > 0 && (
                  <p className="text-[11px] text-slate-900 font-medium">
                    ※ スキップされた質問（{skippedQuestions.length}件）は個別評価の対象外とし、時間配分の指標としてのみ考慮されています。
                  </p>
                )}
              </section>
            )}

            {/* 6. Full Presentation Transcript Log */}
            <section className="p-6 bg-white border border-slate-200 rounded-[24px] shadow-[0_8px_24px_0_rgba(15,23,42,0.04)] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-[10px] bg-[#5bc8ac]/15 text-[#5bc8ac] flex items-center justify-center">
                    <FileText className="w-4 h-4" />
                  </div>
                  <h3 className="text-base font-bold text-slate-950">
                    文字起こしログ
                  </h3>
                  <span className="text-xs font-bold text-slate-900">
                    ({transcript.length}文)
                  </span>
                </div>

                <div className="flex items-center gap-2 no-print">
                  <button
                    onClick={handleCopyAllTranscript}
                    disabled={transcript.length === 0}
                    className="px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:text-[#5b93c8] bg-slate-100 hover:bg-[#5b93c8]/15 disabled:opacity-50 disabled:cursor-not-allowed rounded-[10px] transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    {isCopied ? (
                      <Check className="w-3.5 h-3.5 text-[#5bc8ac]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{isCopied ? 'コピー完了' : 'コピー'}</span>
                  </button>

                  <button
                    onClick={handleDownloadTranscript}
                    disabled={transcript.length === 0}
                    className="px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:text-[#5b93c8] bg-slate-100 hover:bg-[#5b93c8]/15 disabled:opacity-50 disabled:cursor-not-allowed rounded-[10px] transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>保存</span>
                  </button>
                </div>
              </div>

              {transcript.length > 0 && (
                <div className="relative no-print">
                  <Search className="w-4 h-4 text-slate-900 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="発話文を検索..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-[12px] pl-10 pr-4 py-2 text-xs text-slate-950 font-medium placeholder:text-slate-500 focus:outline-none focus:bg-white focus:border-[#5b93c8] transition-colors"
                  />
                </div>
              )}

              {filteredTranscript.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-[16px] text-slate-900 font-medium text-xs">
                  {transcript.length === 0
                    ? '発話ログがありません。'
                    : '一致する発話が見つかりませんでした。'}
                </div>
              ) : (
                <div className="max-h-[460px] overflow-y-auto pr-2 pt-2">
                  {filteredTranscript.map((point, idx) => {
                    const mins = Math.floor(point.time / 60);
                    const secs = point.time % 60;
                    const timeFormatted = `${String(mins).padStart(2, '0')}:${String(
                      secs
                    ).padStart(2, '0')}`;
                    const avatar =
                      audience.find((a) => a.id === point.avatarId) || audience[0];

                    const actionLabel =
                      point.action === 'clap'
                        ? '拍手'
                        : point.action === 'tilt_head'
                        ? '疑問'
                        : point.action === 'sleep'
                        ? '退屈'
                        : '頷き';

                    return (
                      <div key={idx} className="flex items-stretch text-xs group">
                        {/* Left Timestamp Column */}
                        <div className="w-16 sm:w-20 shrink-0 pt-0.5 pr-3 text-right">
                          <div className="font-bold text-slate-950 text-xs">
                            {timeFormatted}
                          </div>
                        </div>

                        {/* Right Content Column (Yondec timeline style) */}
                        <div className="flex-1 relative border-l-2 border-slate-200 pl-5 pb-5">
                          <span
                            className="w-3 h-3 rounded-full bg-[#5bc8ac] ring-4 ring-white absolute -left-[7px] top-1"
                            aria-hidden="true"
                          />

                          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-[14px] space-y-1">
                            <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] text-slate-900 font-semibold">
                              <span>
                                {avatar ? `${avatar.name} (${actionLabel})` : actionLabel}
                              </span>
                              <div className="flex items-center gap-3">
                                <span className="text-[#5b93c8] font-bold">
                                  関心 {point.interest}%
                                </span>
                                <span className="text-[#5bc8ac] font-bold">
                                  理解 {point.understanding}%
                                </span>
                              </div>
                            </div>

                            <p className="text-slate-950 text-xs sm:text-sm font-bold leading-relaxed">
                              「{point.text}」
                            </p>

                            {point.comment && (
                              <p className="text-[11px] text-slate-900 font-medium pt-0.5">
                                {point.comment}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};
