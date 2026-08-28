import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ALEPH T04 — 오늘의 진짜 정보판',
  description: '공개 원천의 값 하나를 매일 기록하고, 데이터가 오지 않을 때도 정직하게 설명하는 정보판',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
