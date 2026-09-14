'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  HEROINES,
  Heroine,
  getHeroineLoreAdvice,
  getHeroineHarnessPingLore,
  getHeroineHarnessReviewLore,
} from './heroines/heroinesData';
import { HeroinePortrait } from './heroines/HeroinePortraits';
import { resolveTheme, Theme } from '@/lib/theme';
import { canUseDarkFantasy } from '@/lib/appRoles';
import type { PublicHarnessAgent } from '@/lib/gost34/agents/types';

interface Session {
  username: string;
  role: string;
}

interface CompanionAlert {
  id: string;
  timestamp: number;
  heroineId: string;
  title: string;
  text: string;
  source: 'system' | 'harness' | 'validation' | 'lore';
  severity: 'info' | 'warn' | 'error' | 'success';
}

type TabType = 'chat' | 'harness' | 'pantheon';

export default function DarkFantasyCompanion() {
  const pathname = usePathname() || '/';
  const [session, setSession] = useState<Session | null>(null);
  const [isSessionLoaded, setIsSessionLoaded] = useState(false);
  const [theme, setTheme] = useState<Theme>('light');

  // Docking & visibility states
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [dockSide, setDockSide] = useState<'right' | 'left'>('right');
  const [activeTab, setActiveTab] = useState<TabType>('chat');

  // Heroine & quotes
  const [activeHeroineId, setActiveHeroineId] = useState<string>('morgana');
  const [quoteIndex, setQuoteIndex] = useState<number>(0);

  // Harness state
  const [agents, setAgents] = useState<PublicHarnessAgent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [harnessBusyId, setHarnessBusyId] = useState<string | null>(null);

  // Notifications
  const [notifications, setNotifications] = useState<CompanionAlert[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [toastAlert, setToastAlert] = useState<CompanionAlert | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Extract calculation ID if current route is within a calculation
  const currentCalcId = useMemo(() => {
    const match = pathname.match(/\/calculations\/([^\/]+)/);
    return match ? match[1] : null;
  }, [pathname]);

  // Load session
  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setSession(data?.session || null);
        setIsSessionLoaded(true);
      })
      .catch(() => {
        setSession(null);
        setIsSessionLoaded(true);
      });
  }, []);

  // Sync theme
  useEffect(() => {
    setTheme(resolveTheme());
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ theme: Theme }>;
      if (customEvent.detail?.theme) {
        setTheme(customEvent.detail.theme);
      } else {
        setTheme(resolveTheme());
      }
    };
    window.addEventListener('evacal-theme-change', handler);
    return () => window.removeEventListener('evacal-theme-change', handler);
  }, []);

  // Restore preferences from localStorage
  useEffect(() => {
    const storedDock = localStorage.getItem('evacal_df_companion_dock');
    if (storedDock === 'left' || storedDock === 'right') {
      setDockSide(storedDock);
    }
    const storedHeroine = localStorage.getItem('evacal_df_heroine');
    if (storedHeroine && HEROINES.some((h) => h.id === storedHeroine)) {
      setActiveHeroineId(storedHeroine);
    }
  }, []);

  const heroine: Heroine = useMemo(
    () => HEROINES.find((h) => h.id === activeHeroineId) || HEROINES[0],
    [activeHeroineId],
  );

  // Fetch harness agents when authorized and in dark-fantasy
  const fetchAgents = useCallback(async () => {
    if (!canUseDarkFantasy(session?.role)) return;
    setIsLoadingAgents(true);
    try {
      const res = await fetch('/api/gost34/agents');
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents || []);
      }
    } catch {
      // Ignore network errors silently
    } finally {
      setIsLoadingAgents(false);
    }
  }, [session?.role]);

  useEffect(() => {
    if (canUseDarkFantasy(session?.role) && theme === 'dark-fantasy') {
      fetchAgents();
    }
  }, [session?.role, theme, fetchAgents]);

  // Helper to add a notification
  const addNotification = useCallback(
    (alert: Omit<CompanionAlert, 'id' | 'timestamp' | 'heroineId'>) => {
      const newAlert: CompanionAlert = {
        ...alert,
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        heroineId: activeHeroineId,
      };

      setNotifications((prev) => [newAlert, ...prev.slice(0, 19)]);

      if (!isExpanded) {
        setUnreadCount((c) => c + 1);
        setToastAlert(newAlert);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => {
          setToastAlert(null);
        }, 6000);
      }
    },
    [activeHeroineId, isExpanded],
  );

  // Contextual lore reaction on pathname change. Читаем остальное через ref:
  // addNotification пересоздаётся на каждый expand/collapse, а смена героини
  // уже уведомляет в selectHeroine — иначе одно событие давало два тоста.
  const loreCtxRef = useRef({ addNotification, activeHeroineId, role: session?.role, theme });
  loreCtxRef.current = { addNotification, activeHeroineId, role: session?.role, theme };
  useEffect(() => {
    const ctx = loreCtxRef.current;
    if (!canUseDarkFantasy(ctx.role) || ctx.theme !== 'dark-fantasy') return;
    const advice = getHeroineLoreAdvice(ctx.activeHeroineId, pathname);
    ctx.addNotification({
      title: advice.title,
      text: advice.text,
      source: 'lore',
      severity: 'info',
    });
  }, [pathname]);

  // Listen to custom system notification events
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{
        title?: string;
        text: string;
        source?: CompanionAlert['source'];
        severity?: CompanionAlert['severity'];
      }>;
      if (ce.detail?.text) {
        addNotification({
          title: ce.detail.title || `${heroine.name} сообщает`,
          text: ce.detail.text,
          source: ce.detail.source || 'system',
          severity: ce.detail.severity || 'info',
        });
      }
    };

    window.addEventListener('evacal-companion-notify', handler);
    return () => window.removeEventListener('evacal-companion-notify', handler);
  }, [addNotification, heroine.name]);

  // Rotate quotes every 15s
  useEffect(() => {
    if (theme !== 'dark-fantasy') return;
    const interval = setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % heroine.quotes.length);
    }, 15000);
    return () => clearInterval(interval);
  }, [theme, heroine.quotes.length]);

  // Handle ESC key to collapse
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isExpanded) {
        setIsExpanded(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded]);

  // If user does not have permission or theme is not dark-fantasy, render NOTHING!
  if (
    !isSessionLoaded ||
    !session ||
    !canUseDarkFantasy(session.role) ||
    theme !== 'dark-fantasy'
  ) {
    return null;
  }

  const toggleExpand = () => {
    const next = !isExpanded;
    setIsExpanded(next);
    localStorage.setItem('evacal_df_companion_expanded', String(next));
    if (next) {
      setUnreadCount(0);
      setToastAlert(null);
    }
  };

  const toggleDock = () => {
    const next = dockSide === 'right' ? 'left' : 'right';
    setDockSide(next);
    localStorage.setItem('evacal_df_companion_dock', next);
  };

  const selectHeroine = (id: string) => {
    setActiveHeroineId(id);
    localStorage.setItem('evacal_df_heroine', id);
    setQuoteIndex(0);
    const advice = getHeroineLoreAdvice(id, pathname);
    addNotification({
      title: `${HEROINES.find((h) => h.id === id)?.name || id} вступает в свиту`,
      text: advice.text,
      source: 'lore',
      severity: 'success',
    });
  };

  // Harness Action: Ping
  const pingAgent = async (agent: PublicHarnessAgent) => {
    setHarnessBusyId(agent.id);
    try {
      const res = await fetch(`/api/gost34/agents/${agent.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'ping' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const lore = getHeroineHarnessPingLore(activeHeroineId, agent.name, true);
        addNotification({
          title: `Пинг успешен: ${agent.name}`,
          text: lore,
          source: 'harness',
          severity: 'success',
        });
      } else {
        const lore = getHeroineHarnessPingLore(
          activeHeroineId,
          agent.name,
          false,
          data?.error || 'Сетевая ошибка',
        );
        addNotification({
          title: `Ошибка связи: ${agent.name}`,
          text: lore,
          source: 'harness',
          severity: 'error',
        });
      }
      await fetchAgents();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Сбой сети';
      addNotification({
        title: `Сбой агента: ${agent.name}`,
        text: getHeroineHarnessPingLore(activeHeroineId, agent.name, false, msg),
        source: 'harness',
        severity: 'error',
      });
    } finally {
      setHarnessBusyId(null);
    }
  };

  // Harness Action: Review calculation
  const reviewCurrentCalculation = async (agent: PublicHarnessAgent) => {
    if (!currentCalcId) {
      addNotification({
        title: 'Требуется расчёт',
        text: 'Перейдите на страницу любого расчёта или Студии ГОСТ 34, чтобы запустить проверку агентом.',
        source: 'harness',
        severity: 'warn',
      });
      return;
    }

    setHarnessBusyId(agent.id);
    try {
      const res = await fetch(`/api/gost34/agents/${agent.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'review', calculationId: currentCalcId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const findingsCount = data?.result?.findings?.length || 0;
        const lore = getHeroineHarnessReviewLore(activeHeroineId, agent.name, findingsCount);
        addNotification({
          title: `Ревью ГОСТ 34: ${agent.name}`,
          text: lore,
          source: 'harness',
          severity: findingsCount > 0 ? 'warn' : 'success',
        });
      } else {
        addNotification({
          title: `Ошибка ревью: ${agent.name}`,
          text: data?.error || 'Не удалось запустить ревью',
          source: 'harness',
          severity: 'error',
        });
      }
      await fetchAgents();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка запуска';
      addNotification({
        title: `Ошибка вызова: ${agent.name}`,
        text: msg,
        source: 'harness',
        severity: 'error',
      });
    } finally {
      setHarnessBusyId(null);
    }
  };

  // Harness Action: Toggle Enabled
  const toggleAgentEnabled = async (agent: PublicHarnessAgent) => {
    setHarnessBusyId(agent.id);
    try {
      await fetch(`/api/gost34/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !agent.enabled }),
      });
      await fetchAgents();
    } finally {
      setHarnessBusyId(null);
    }
  };

  const dockClass = dockSide === 'left' ? 'left-5 items-start' : 'right-5 items-end';

  return (
    <aside
      aria-label="Спутница Тёмного Фэнтези и Харнесс"
      className={`fixed bottom-4 ${dockClass} z-30 flex flex-col pointer-events-none select-none`}
    >
      {/* Non-intrusive floating toast preview when collapsed */}
      {!isExpanded && toastAlert && (
        <div
          onClick={toggleExpand}
          className="mb-2 max-w-xs cursor-pointer pointer-events-auto rounded-2xl border border-purple-500/50 bg-slate-950/95 p-3 shadow-[0_4px_25px_rgba(168,85,247,0.35)] backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <div className="flex items-center justify-between gap-1.5 border-b border-purple-900/50 pb-1.5 mb-1.5">
            <span className="text-[10px] font-bold text-purple-300 flex items-center gap-1">
              <span>{heroine.avatarIcon}</span>
              <span>{toastAlert.title}</span>
            </span>
            <span className="text-[9px] text-purple-400/80">клик — открыть</span>
          </div>
          <p className="text-[11px] text-purple-100 italic leading-snug line-clamp-3">
            {toastAlert.text}
          </p>
        </div>
      )}

      {/* Main Expanded Window */}
      {isExpanded ? (
        <div className="w-[360px] max-h-[520px] pointer-events-auto flex flex-col rounded-2xl border border-purple-500/40 bg-slate-950/95 shadow-[0_8px_32px_rgba(0,0,0,0.85),0_0_30px_rgba(168,85,247,0.3)] backdrop-blur-xl animate-in zoom-in-95 duration-150 overflow-hidden text-purple-100">
          {/* Header Bar */}
          <div className="px-3.5 py-2.5 bg-purple-950/40 border-b border-purple-800/40 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base">{heroine.avatarIcon}</span>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-purple-200 truncate">{heroine.name}</span>
                <span className="text-[9px] text-purple-400 truncate leading-none">
                  {heroine.role}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0 text-xs">
              <button
                type="button"
                onClick={toggleDock}
                className="p-1 rounded text-[11px] text-purple-400 hover:text-purple-200 hover:bg-purple-900/50 transition-colors"
                title={`Перенести на другую сторону (сейчас: ${dockSide === 'right' ? 'справа' : 'слева'})`}
                aria-label="Сменить сторону"
              >
                ⇄
              </button>
              <button
                type="button"
                onClick={toggleExpand}
                className="p-1 rounded text-purple-400 hover:text-purple-200 hover:bg-purple-900/50 transition-colors"
                title="Свернуть окно"
                aria-label="Свернуть"
              >
                —
              </button>
            </div>
          </div>

          {/* Mode Tabs */}
          <div className="flex items-center border-b border-purple-900/40 bg-slate-950 px-2 pt-1.5 gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-t-lg transition-all flex items-center justify-center gap-1 ${
                activeTab === 'chat'
                  ? 'bg-purple-950/60 text-purple-200 border-t border-x border-purple-600/40'
                  : 'text-purple-400 hover:text-purple-200 hover:bg-purple-950/30'
              }`}
            >
              <span>🔮</span>
              <span>Вестник</span>
              {notifications.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 text-[9px] rounded-full bg-purple-800 text-purple-200">
                  {notifications.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('harness')}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-t-lg transition-all flex items-center justify-center gap-1 ${
                activeTab === 'harness'
                  ? 'bg-purple-950/60 text-purple-200 border-t border-x border-purple-600/40'
                  : 'text-purple-400 hover:text-purple-200 hover:bg-purple-950/30'
              }`}
            >
              <span>⚡</span>
              <span>Харнесс</span>
              {agents.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 text-[9px] rounded-full bg-indigo-900/80 text-indigo-200">
                  {agents.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('pantheon')}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-t-lg transition-all flex items-center justify-center gap-1 ${
                activeTab === 'pantheon'
                  ? 'bg-purple-950/60 text-purple-200 border-t border-x border-purple-600/40'
                  : 'text-purple-400 hover:text-purple-200 hover:bg-purple-950/30'
              }`}
            >
              <span>👥</span>
              <span>Пантеон</span>
            </button>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 scrollbar-thin scrollbar-thumb-purple-900">
            {/* TAB 1: Чат и Оповещения */}
            {activeTab === 'chat' && (
              <div className="space-y-3">
                {/* Heroine Card with animated speech */}
                <div className="flex items-start gap-3 p-2.5 rounded-xl bg-purple-950/30 border border-purple-800/30">
                  <div
                    onClick={() => setActiveTab('pantheon')}
                    className="relative shrink-0 cursor-pointer group"
                    title="Сменить деву в Пантеоне"
                  >
                    <HeroinePortrait heroineId={heroine.id} size={54} showFrame={false} />
                    <span className="absolute -bottom-1 -right-1 text-[10px]">
                      {heroine.avatarIcon}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div
                      onClick={() => setQuoteIndex((i) => (i + 1) % heroine.quotes.length)}
                      className="cursor-pointer group/quote rounded-lg bg-slate-900/80 border border-purple-900/40 p-2 hover:border-purple-600/50 transition-colors"
                      title="Клик — следующая реплика"
                    >
                      <p className="text-xs text-purple-100 italic leading-relaxed">
                        {heroine.quotes[quoteIndex]}
                      </p>
                      <div className="mt-1 flex items-center justify-between text-[9px] text-purple-400/70">
                        <span>{heroine.badge}</span>
                        <span>клик ✦</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Prompt for advice */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase font-bold text-purple-400 tracking-wider">
                    Лента оповещений
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const advice = getHeroineLoreAdvice(activeHeroineId, pathname);
                      addNotification({
                        title: advice.title,
                        text: advice.text,
                        source: 'lore',
                        severity: 'info',
                      });
                    }}
                    className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-900/50 hover:bg-purple-800 text-purple-200 border border-purple-600/40 transition-colors"
                  >
                    🔮 Прорицание экрана
                  </button>
                </div>

                {/* Feed of Alerts */}
                <div className="space-y-2">
                  {notifications.length === 0 ? (
                    <div className="text-center py-6 text-xs text-purple-400/60 italic">
                      Пока нет новых событий. Дева следит за проектом.
                    </div>
                  ) : (
                    notifications.map((n) => {
                      const severityColor =
                        n.severity === 'error'
                          ? 'border-rose-500/50 bg-rose-950/30 text-rose-200'
                          : n.severity === 'warn'
                            ? 'border-amber-500/50 bg-amber-950/30 text-amber-200'
                            : n.severity === 'success'
                              ? 'border-emerald-500/50 bg-emerald-950/30 text-emerald-200'
                              : 'border-purple-900/40 bg-purple-950/20 text-purple-200';

                      return (
                        <div
                          key={n.id}
                          className={`p-2.5 rounded-xl border text-xs leading-relaxed space-y-1 ${severityColor}`}
                        >
                          <div className="flex items-center justify-between gap-1 text-[10px] font-bold opacity-80">
                            <span>{n.title}</span>
                            <span className="font-mono text-[9px] opacity-60">
                              {new Date(n.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <p className="text-[11px] font-normal leading-relaxed">{n.text}</p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: Харнесс Агенты */}
            {activeTab === 'harness' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 border-b border-purple-900/40 pb-2">
                  <div>
                    <h4 className="text-xs font-bold text-purple-200">
                      Харнесс-агенты ({agents.length})
                    </h4>
                    <p className="text-[10px] text-purple-400">
                      Внешние сервисы ревью и обогащения ГОСТ 34
                    </p>
                  </div>
                  <Link
                    href="/agents"
                    className="px-2 py-1 rounded text-[10px] font-semibold bg-purple-900/40 hover:bg-purple-800/60 border border-purple-500/40 text-purple-200 transition-colors"
                  >
                    ⚙️ Настройки
                  </Link>
                </div>

                {isLoadingAgents ? (
                  <div className="text-center py-6 text-xs text-purple-300">
                    ⏳ Опрос астрального шлюза...
                  </div>
                ) : agents.length === 0 ? (
                  <div className="text-center py-6 space-y-2.5">
                    <p className="text-xs text-purple-300 leading-relaxed italic">
                      «Твой харнесс пуст, путник. Призови первого агента в реестре, и мы обучим его
                      проверять комплекты ГОСТ 34.»
                    </p>
                    <Link
                      href="/agents"
                      className="inline-block px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-700 hover:bg-purple-600 text-white shadow-md transition-colors"
                    >
                      + Подключить агента
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {agents.map((agent) => {
                      const isBusy = harnessBusyId === agent.id;
                      const statusOk = agent.lastStatus === 'ok';

                      return (
                        <div
                          key={agent.id}
                          className="p-3 rounded-xl border border-purple-900/50 bg-purple-950/20 space-y-2 hover:border-purple-700/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-purple-200">
                                  {agent.name}
                                </span>
                                <span
                                  className={`w-2 h-2 rounded-full ${
                                    agent.enabled
                                      ? statusOk
                                        ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                                        : 'bg-amber-400'
                                      : 'bg-slate-500'
                                  }`}
                                  title={
                                    !agent.enabled
                                      ? 'Выключен'
                                      : statusOk
                                        ? 'В сети (OK)'
                                        : 'Требует проверки'
                                  }
                                />
                              </div>
                              <p className="text-[10px] text-purple-400 font-mono truncate max-w-[200px]">
                                {agent.endpoint}
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() => toggleAgentEnabled(agent)}
                              disabled={isBusy}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition-colors ${
                                agent.enabled
                                  ? 'border-emerald-500/40 text-emerald-300 bg-emerald-950/40'
                                  : 'border-slate-700 text-slate-400 bg-slate-900'
                              }`}
                            >
                              {agent.enabled ? 'Активен' : 'Отключён'}
                            </button>
                          </div>

                          <div className="flex items-center gap-1.5 pt-1 border-t border-purple-900/30">
                            <button
                              type="button"
                              onClick={() => pingAgent(agent)}
                              disabled={isBusy || !agent.enabled}
                              className="flex-1 py-1 px-2 rounded-lg text-[10px] font-bold bg-purple-900/40 hover:bg-purple-800/60 border border-purple-600/40 text-purple-200 disabled:opacity-40 transition-colors flex items-center justify-center gap-1"
                            >
                              <span>⚡</span>
                              <span>{isBusy ? 'Пинг...' : 'Пинг'}</span>
                            </button>

                            {currentCalcId && (
                              <button
                                type="button"
                                onClick={() => reviewCurrentCalculation(agent)}
                                disabled={isBusy || !agent.enabled}
                                className="flex-1 py-1 px-2 rounded-lg text-[10px] font-bold bg-brand-700/60 hover:bg-brand-600 border border-brand-500/40 text-white disabled:opacity-40 transition-colors flex items-center justify-center gap-1"
                                title="Запустить проверку текущего расчёта ГОСТ 34"
                              >
                                <span>🔍</span>
                                <span>Ревью</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: Пантеон дев */}
            {activeTab === 'pantheon' && (
              <div className="space-y-3">
                <div className="border-b border-purple-900/40 pb-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-200">
                    Пантеон Дев Тёмного Фэнтези
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      window.dispatchEvent(new CustomEvent('evacal-easter-egg-trigger'))
                    }
                    className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-900/50 hover:bg-purple-800 text-purple-200 border border-purple-600/40 transition-colors"
                    title="Запустить полноэкранное видение (пасхалка)"
                  >
                    🎬 Видение
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {HEROINES.map((h) => {
                    const active = h.id === activeHeroineId;
                    return (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => selectHeroine(h.id)}
                        className={`p-2 rounded-xl border text-left flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                          active
                            ? 'border-purple-400 bg-purple-900/40 shadow-[0_0_15px_rgba(192,132,252,0.4)]'
                            : 'border-purple-900/40 bg-slate-900/60 hover:border-purple-600/60 hover:bg-purple-950/40'
                        }`}
                      >
                        <div className="relative">
                          <HeroinePortrait heroineId={h.id} size={50} showFrame={false} />
                          {active && (
                            <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-500 text-[9px] text-white font-bold">
                              ✓
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-bold text-purple-200 text-center leading-tight">
                          {h.name}
                        </span>
                        <span className="text-[9px] text-purple-400 text-center leading-none">
                          {h.role}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Collapsed Floating Avatar Orb (Never blocks clicks or UI) */
        <button
          type="button"
          onClick={toggleExpand}
          className="group pointer-events-auto relative flex items-center justify-center w-11 h-11 rounded-full border border-purple-400/60 bg-slate-950/90 shadow-[0_0_20px_rgba(168,85,247,0.4)] backdrop-blur-md hover:scale-110 hover:border-purple-300 transition-all cursor-pointer focus:outline-none"
          aria-label={`Открыть спутницу: ${heroine.name}`}
          title={`${heroine.name} (${heroine.role}) — нажмите, чтобы открыть оповещения и харнесс`}
        >
          <div className="w-9 h-9 rounded-full overflow-hidden">
            <HeroinePortrait heroineId={heroine.id} size={36} showFrame={false} />
          </div>

          {/* Glowing pulse indicator */}
          <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-500 border border-white" />
          </span>

          {unreadCount > 0 && (
            <span className="absolute -bottom-1 -left-1 px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-rose-600 text-white shadow-sm">
              {unreadCount}
            </span>
          )}
        </button>
      )}
    </aside>
  );
}
