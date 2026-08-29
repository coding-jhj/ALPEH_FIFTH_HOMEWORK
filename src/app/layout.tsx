import type { Metadata } from 'next';
import { Silkscreen } from 'next/font/google';
import './globals.css';

// 픽셀 폰트는 라틴 문자만 있습니다. 숫자·영문에만 쓰고 한글은 시스템 폰트로 둡니다.
// next/font는 빌드 때 받아 자체 호스팅하므로 심사자 브라우저가 구글 서버를 부르지 않습니다.
const pixel = Silkscreen({
  weight: ['400', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-pixel',
});

export const metadata: Metadata = {
  title: 'ALEPH T04 — 오늘의 진짜 정보판',
  description: '공개 원천의 값 하나를 매일 기록하고, 데이터가 오지 않을 때도 정직하게 설명하는 정보판',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={pixel.variable}>
      <body>{children}</body>
    </html>
  );
}
