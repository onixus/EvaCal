import type { ReactNode } from 'react';

/**
 * Заголовок экрана: название, одна строка пояснения и действия справа.
 * Единый для всех списков и дашбордов, чтобы экраны начинались одинаково
 * и кнопки не гуляли между левым и правым краем.
 */
export default function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Строка под заголовком: фильтры, вкладки. */
  children?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-nord-6">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 max-w-3xl text-xs text-slate-500 dark:text-nord-muted">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
