import type { Metadata } from 'next';
import './globals.css';
import Nav from '@/components/Nav';
import DarkFantasyCompanion from '@/components/DarkFantasyCompanion';
import InactivityEasterEgg from '@/components/InactivityEasterEgg';
import { THEME_INIT_SCRIPT } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'EvaCal — калькулятор трудозатрат',
  description: 'Расчёт трудозатрат в человеко-часах по этапам проекта',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <DarkFantasyCompanion />
        <InactivityEasterEgg />
      </body>
    </html>
  );
}
