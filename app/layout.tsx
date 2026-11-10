import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Preプレ',
  description:
    '3Dアバター聴衆の前で実践的なプレゼン練習ができるAI対話型シミュレーション。リアルタイム感情分析、挙手・指名制質疑応答、タイムライン分析レポート。',
  openGraph: {
    title: 'Preプレ',
    description:
      '3Dアバター聴衆の前で実践的なプレゼン練習ができるAI対話型シミュレーション。リアルタイム感情分析、挙手・指名制質疑応答、タイムライン分析レポート。',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
