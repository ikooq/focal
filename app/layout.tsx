import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'focal. — Пространство внимания',
  description: 'Локальные задачи, энергия, финансы и глубокий фокус.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className="dark">
      <body>{children}</body>
    </html>
  );
}
