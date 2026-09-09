import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '共通テスト攻略ノート',
  description:
    '問題冊子をめくり、根拠・対訳・単語帳を使って攻略する英語学習ゲーム。',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
