'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { resolveTheme, Theme } from '@/lib/theme';

const INACTIVITY_TIMEOUT_MS = 45000; // 45 seconds
const VIDEO_SRC = '/videos/easter_egg.mp4';

/**
 * Full-screen dark-fantasy easter egg video player.
 * Triggers after 45 s of inactivity when the dark-fantasy theme is active.
 */
export default function InactivityEasterEgg() {
  const [theme, setTheme] = useState<Theme>('light');
  const [isOpen, setIsOpen] = useState(false);
  const [timeLeft, setTimeLeft] = useState(45);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Listen to theme changes & manual triggers
  useEffect(() => {
    setTheme(resolveTheme());
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ theme: Theme }>;
      if (ce.detail?.theme) setTheme(ce.detail.theme);
      else setTheme(resolveTheme());
    };
    const manualHandler = () => setIsOpen(true);
    window.addEventListener('evacal-theme-change', handler);
    window.addEventListener('evacal-easter-egg-trigger', manualHandler);
    return () => {
      window.removeEventListener('evacal-theme-change', handler);
      window.removeEventListener('evacal-easter-egg-trigger', manualHandler);
    };
  }, []);

  // Auto-play video when opened
  useEffect(() => {
    if (isOpen && videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
    if (!isOpen && videoRef.current) {
      videoRef.current.pause();
    }
  }, [isOpen]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    setTimeLeft(45);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    if (theme === 'dark-fantasy') {
      timerRef.current = setTimeout(() => setIsOpen(true), INACTIVITY_TIMEOUT_MS);
      countdownRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - lastActivityRef.current) / 1000);
        setTimeLeft(Math.max(0, 45 - elapsed));
      }, 1000);
    }
  }, [theme]);

  // Track activity
  useEffect(() => {
    if (theme !== 'dark-fantasy') {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      return;
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    const onActivity = () => { if (!isOpen) resetTimer(); };
    events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    resetTimer();
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
      if (timerRef.current) clearTimeout(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [theme, isOpen, resetTimer]);

  // ESC / Space to close
  useEffect(() => {
    if (!isOpen) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ') {
        close();
        resetTimer();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [isOpen, close, resetTimer]);

  if (theme !== 'dark-fantasy') return null;

  return (
    <>
      {/* Inactivity progress bar */}
      {!isOpen && (
        <div style={{
          position: 'fixed',
          bottom: 0, left: 0, right: 0,
          height: '2px',
          zIndex: 30,
          pointerEvents: 'none',
          background: 'rgba(30, 0, 50, 0.4)',
        }}>
          <div style={{
            height: '100%',
            width: `${((45 - timeLeft) / 45) * 100}%`,
            background: 'linear-gradient(90deg, #e879f9, #c084fc, #38bdf8, #f43f5e)',
            opacity: 0.5,
            transition: 'width 1s linear',
          }} />
        </div>
      )}

      {/* ===== FULL-SCREEN VIDEO EASTER EGG ===== */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: '#000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <style>{`
            @keyframes ee-fade-in { from { opacity: 0 } to { opacity: 1 } }
            @keyframes ee-btn-glow { 0%,100% { box-shadow: 0 0 15px rgba(168,85,247,0.4) } 50% { box-shadow: 0 0 30px rgba(168,85,247,0.7) } }
          `}</style>

          {/* Full-screen video */}
          <video
            ref={videoRef}
            src={VIDEO_SRC}
            autoPlay
            loop
            playsInline
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              animation: 'ee-fade-in 1.5s ease-out',
            }}
          />

          {/* Close button — top right */}
          <button
            onClick={() => { close(); resetTimer(); }}
            style={{
              position: 'absolute',
              top: '24px',
              right: '24px',
              zIndex: 10,
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              border: '1px solid rgba(168,85,247,0.5)',
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(8px)',
              color: '#d4d4d8',
              fontSize: '20px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: 'ee-btn-glow 3s ease-in-out infinite',
              transition: 'all 0.3s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#a855f7';
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.transform = 'scale(1.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(168,85,247,0.5)';
              e.currentTarget.style.color = '#d4d4d8';
              e.currentTarget.style.transform = 'scale(1)';
            }}
            title="Закрыть (Esc / Пробел)"
          >
            ✕
          </button>

          {/* Bottom hint */}
          <div style={{
            position: 'absolute',
            bottom: '24px',
            left: 0, right: 0,
            textAlign: 'center',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
            animation: 'ee-fade-in 3s ease-out',
          }}>
            <span style={{
              fontFamily: 'monospace',
              fontSize: '11px',
              letterSpacing: '0.2em',
              color: 'rgba(168,85,247,0.6)',
              textTransform: 'uppercase',
              textShadow: '0 0 20px rgba(0,0,0,0.8)',
            }}>
              ✦ Тёмное Видение — пасхалка 45с бездействия ✦
            </span>
            <button
              onClick={() => { close(); resetTimer(); }}
              style={{
                padding: '8px 24px',
                borderRadius: '999px',
                border: '1px solid rgba(168,85,247,0.4)',
                background: 'rgba(0,0,0,0.5)',
                backdropFilter: 'blur(8px)',
                color: '#c4b5fd',
                fontSize: '13px',
                fontFamily: 'monospace',
                cursor: 'pointer',
                transition: 'all 0.3s',
                letterSpacing: '0.1em',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(168,85,247,0.3)';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(0,0,0,0.5)';
                e.currentTarget.style.color = '#c4b5fd';
              }}
            >
              Вернуться в EvaCal [ESC]
            </button>
          </div>
        </div>
      )}
    </>
  );
}
