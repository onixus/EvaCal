import type { Metadata } from 'next';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';

export const metadata: Metadata = { title: 'Пример рабочего стола — EvaCal' };

/**
 * Статический пример упрощённого рабочего стола. Боевые маршруты, роли и
 * подписи не затронуты: страница показывает, как выглядит словарь после
 * рецензии, и никуда не ходит за данными.
 */

type Chip = 'ok' | 'warn' | 'block' | 'info' | 'muted';

const CHIP: Record<Chip, string> = {
  ok: 'chip-ok',
  warn: 'chip-warn',
  block: 'chip-block',
  info: 'chip-info',
  muted: 'chip-muted',
};

interface Phase {
  name: string;
  hint: string;
  count: number;
  gap?: string;
  states: { label: string; count: number; chip: Chip }[];
}

const PHASES: Phase[] = [
  {
    name: 'Смета',
    hint: 'Считаем трудозатраты',
    count: 4,
    states: [
      { label: 'черновик', count: 3, chip: 'muted' },
      { label: 'на согласовании', count: 1, chip: 'warn' },
    ],
  },
  {
    name: 'Согласование',
    hint: 'Архитектор утверждает смету',
    count: 2,
    states: [{ label: 'ждут вас', count: 2, chip: 'warn' }],
  },
  {
    name: 'Документы',
    hint: 'Комплект по ГОСТ 34',
    count: 6,
    gap: '2 сметы утверждены, комплект не начат',
    states: [
      { label: 'не начаты', count: 2, chip: 'block' },
      { label: 'черновик', count: 3, chip: 'muted' },
      { label: 'возвращены', count: 1, chip: 'warn' },
    ],
  },
  {
    name: 'Проверка',
    hint: 'Два разных решения, одно место',
    count: 3,
    states: [
      { label: 'нормоконтроль', count: 2, chip: 'info' },
      { label: 'ждёт подписи', count: 1, chip: 'warn' },
    ],
  },
  {
    name: 'Сделка',
    hint: 'Комплект выпущен',
    count: 5,
    states: [
      { label: 'выпущен', count: 3, chip: 'ok' },
      { label: 'закрыта', count: 2, chip: 'muted' },
    ],
  },
];

interface Task {
  verb: string;
  object: string;
  project: string;
  due: string;
  chip: Chip;
  chipLabel: string;
}

const TASKS: Task[] = [
  {
    verb: 'Исправить замечания',
    object: 'ТЗ, раздел 4',
    project: 'Портал заявителя · Минцифры',
    due: 'просрочено на 2 дня',
    chip: 'block',
    chipLabel: 'возвращён',
  },
  {
    verb: 'Утвердить смету',
    object: '412 ч · 3 этапа спорные',
    project: 'АИС кадастра · Росреестр',
    due: 'сегодня',
    chip: 'warn',
    chipLabel: 'на согласовании',
  },
  {
    verb: 'Начать комплект',
    object: 'смета утверждена 6 дней назад',
    project: 'Шлюз СМЭВ · ФНС',
    due: 'документы не начаты',
    chip: 'block',
    chipLabel: 'не начаты',
  },
  {
    verb: 'Ответить на вопрос',
    object: 'норма применимости не подтверждена',
    project: 'Витрина данных · Казначейство',
    due: 'до пятницы',
    chip: 'info',
    chipLabel: 'нормоконтроль',
  },
];

const NAV: { label: string; active?: boolean; badge?: number }[] = [
  { label: 'Рабочий стол', active: true },
  { label: 'Проекты' },
  { label: 'Расчёты' },
  { label: 'Документы по ГОСТ 34', badge: 4 },
  { label: 'Проверка документов', badge: 3 },
  { label: 'Отчёты' },
];

const MORE: { title: string; items: { label: string; hint: string }[] }[] = [
  {
    title: 'Справочники',
    items: [
      { label: 'Каталог этапов', hint: 'из чего собирается смета' },
      { label: 'Типовые решения', hint: 'готовые наборы работ' },
      { label: 'Оборудование и ПО', hint: 'что поставляем заказчику' },
    ],
  },
  {
    title: 'Редко',
    items: [
      { label: 'Загрузка команды', hint: 'кто свободен в ближайшие недели' },
      { label: 'Рейтинг', hint: 'открытый, без данных заказчиков' },
      { label: 'Журнал правок', hint: 'кто и что менял' },
      { label: 'Помощники', hint: 'подключаемые проверки, ничего не меняют сами' },
    ],
  },
];

const WIZARD = [
  ['Оформление', 'Редакция ГОСТ 34 и внешний вид'],
  ['Требования', 'Что система должна делать'],
  ['Какие нормы действуют', 'Подтвердите нормы этого проекта'],
  ['Связь с работами', 'Какое требование какими работами закрыто'],
  ['Подписи', 'Кто указан на титульном листе'],
  ['Просмотр', 'Прочитайте текст и поправьте'],
  ['Выпуск', 'Проверка и скачивание'],
];

function Mark({ children }: { children: string }) {
  return <span className="text-slate-400 dark:text-nord-muted">{children}</span>;
}

export default function UiPreviewPage() {
  return (
    <div className="page">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-nord-yellow/40 dark:bg-nord-yellow/10 dark:text-nord-yellow">
        <span>
          Пример, не рабочий стол. Данные выдуманы, ссылки ведут на эту же страницу. Боевые экраны
          не менялись.
        </span>
        <Link href="/" className="font-semibold underline">
          К настоящему рабочему столу
        </Link>
      </div>

      <PageHeader
        title="Рабочий стол"
        description="Архитектор. Сначала то, что ждёт вас. Конвейер — чтобы видеть, где проект застрял."
        actions={
          <>
            <span className="btn-secondary">Все проекты</span>
            <span className="btn-primary">+ Новый расчёт</span>
          </>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[232px_minmax(0,1fr)]">
        <nav aria-label="Пример меню" className="card p-2">
          <p className="px-2.5 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-nord-muted">
            Работа
          </p>
          <ul className="space-y-0.5">
            {NAV.map((item) => (
              <li key={item.label}>
                <span
                  aria-current={item.active ? 'page' : undefined}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                    item.active
                      ? 'bg-brand-50 text-brand-700 dark:bg-nord-3 dark:text-nord-frost2'
                      : 'text-slate-700 dark:text-nord-4'
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  {item.badge ? (
                    <span className="nums ml-auto rounded-full bg-slate-100 px-1.5 text-[10px] font-extrabold text-slate-500 dark:bg-nord-1 dark:text-nord-muted">
                      {item.badge}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>

          {MORE.map((group) => (
            <div key={group.title} className="mt-3">
              <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-nord-muted">
                {group.title}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.label} className="px-2.5 py-1">
                    <span className="block text-xs font-semibold text-slate-700 dark:text-nord-4">
                      {item.label}
                    </span>
                    <span className="block text-[10px] leading-snug text-slate-400 dark:text-nord-muted">
                      {item.hint}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <p className="mt-3 border-t border-slate-100 px-2.5 pt-2 text-[10px] leading-relaxed text-slate-400 dark:border-nord-3 dark:text-nord-muted">
            «Ещё» нет. Справочники и редкие экраны — две подписанные группы, а не один ящик.
          </p>
        </nav>

        <div className="space-y-5">
          <section className="card" aria-labelledby="now-title">
            <div className="card-head">
              <h2 id="now-title" className="card-title">
                Сделать сейчас
              </h2>
              <span className="text-xs text-slate-500 dark:text-nord-muted">
                4 из 4 · важнее сверху
              </span>
            </div>
            <ul className="divide-y divide-slate-100 dark:divide-nord-3">
              {TASKS.map((task) => (
                <li key={task.object} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-slate-900 dark:text-nord-6">
                      {task.verb} <Mark>·</Mark> {task.object}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500 dark:text-nord-muted">
                      {task.project}
                    </span>
                  </span>
                  <span className={CHIP[task.chip]}>{task.chipLabel}</span>
                  <span className="hidden w-40 truncate text-right text-[11px] text-slate-500 sm:block dark:text-nord-muted">
                    {task.due}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-4" aria-labelledby="pipeline-title">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="pipeline-title" className="card-title">
                Где стоят проекты
              </h2>
              <span className="text-xs text-slate-500 dark:text-nord-muted">
                5 фаз вместо 8 плиток. Узкое место не спрятано: оно красным внутри фазы.
              </span>
            </div>
            <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {PHASES.map((phase, i) => (
                <li
                  key={phase.name}
                  className={`flex flex-col rounded-lg border px-3 py-2.5 ${
                    phase.gap
                      ? 'border-rose-200 bg-rose-50/40 dark:border-nord-red/40 dark:bg-nord-red/10'
                      : 'border-slate-200 bg-white dark:border-nord-3 dark:bg-nord-2'
                  }`}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-nord-muted">
                    {i + 1}. {phase.name}
                  </span>
                  <span className="nums mt-0.5 text-xl font-extrabold text-slate-900 dark:text-nord-6">
                    {phase.count}
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-nord-muted">
                    {phase.hint}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-1">
                    {phase.states.map((state) => (
                      <span key={state.label} className={CHIP[state.chip]}>
                        {state.label} {state.count}
                      </span>
                    ))}
                  </span>
                  {phase.gap ? (
                    <span className="mt-2 text-[10px] font-semibold leading-snug text-rose-700 dark:text-nord-redText">
                      {phase.gap}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>

          <section className="card" aria-labelledby="wizard-title">
            <div className="card-head">
              <h2 id="wizard-title" className="card-title">
                Мастер комплекта — те же 7 шагов
              </h2>
              <span className="text-xs text-slate-500 dark:text-nord-muted">
                подпись — задача, номер стандарта — внутри шага
              </span>
            </div>
            <ol className="grid gap-px bg-slate-100 sm:grid-cols-2 dark:bg-nord-3">
              {WIZARD.map(([title, hint], i) => (
                <li key={title} className="bg-white px-4 py-2.5 dark:bg-nord-2">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-nord-muted">
                    Шаг {i + 1}
                  </span>
                  <span className="mt-0.5 block text-xs font-semibold text-slate-900 dark:text-nord-6">
                    {title}
                  </span>
                  <span className="block text-[11px] text-slate-500 dark:text-nord-muted">
                    {hint}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
