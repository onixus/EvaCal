import type { Metadata } from 'next';
import './globals.css';
import AppSidebar from '@/components/AppSidebar';
import AppHeader from '@/components/AppHeader';
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
              Ширина экрана задаётся самим экраном (`.page` / `.page-wide`):
              студия и ревью — трёхколоночные и занимают всю полосу, списки
              держат читаемую ширину.
            */}
            <main className="min-w-0 flex-1 px-5 py-5 sm:px-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
