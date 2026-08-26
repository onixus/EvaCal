import type { Metadata } from 'next';
import './globals.css';
import AppSidebar from '@/components/AppSidebar';
import AppHeader from '@/components/AppHeader';
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
        <div className="app-shell">
          <AppSidebar />
          <div className="flex min-w-0 flex-col">
            <AppHeader />
            {/*
              Ширина не ограничена общим max-w: студия и ревью — трёхколоночные
              экраны, которым нужна вся полоса, а узкие страницы держат свою
              ширину сами.
            */}
            <main className="min-w-0 flex-1 px-4 py-5">{children}</main>
          </div>
        </div>
        <DarkFantasyCompanion />
        <InactivityEasterEgg />
      </body>
    </html>
  );
}
