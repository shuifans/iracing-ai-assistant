import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'iRacing AI 助手',
  description: '面向 iRacing 玩家的中文智能问答助手',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
