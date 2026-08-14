/* eslint-disable @next/next/no-img-element */
import React from 'react';

interface PortraitProps {
  heroineId: string;
  size?: number;
  className?: string;
  showFrame?: boolean;
}

const HEROINE_IMAGES: Record<string, { full: string; avatar: string; alt: string }> = {
  morgana: {
    full: '/images/morgana.png',
    avatar: '/images/morgana_avatar.png',
    alt: 'Моргана — Архимаг Бездны',
  },
  eir: {
    full: '/images/eir.png',
    avatar: '/images/eir_avatar.png',
    alt: 'Валькирия Эйр — Дева Ночи',
  },
  selene: {
    full: '/images/selene.png',
    avatar: '/images/selene_avatar.png',
    alt: 'Селена — Лунный Оракул',
  },
  lilith: {
    full: '/images/lilith.png',
    avatar: '/images/lilith_avatar.png',
    alt: 'Лилит — Чародейка Пресейла',
  },
};

export function HeroinePortrait({ heroineId, size = 120, className = '', showFrame = true }: PortraitProps) {
  const data = HEROINE_IMAGES[heroineId] || HEROINE_IMAGES.morgana;
  const imageSrc = showFrame ? data.full : data.avatar;

  return (
    <div
      style={{ width: size, height: showFrame ? (size * 2) / 3 : size }}
      className={`relative overflow-hidden rounded-xl border border-purple-500/40 bg-slate-950 shadow-[0_4px_20px_rgba(0,0,0,0.7)] ${className}`}
    >
      <img
        src={imageSrc}
        alt={data.alt}
        className="w-full h-full object-cover select-none pointer-events-none transition-transform duration-300 group-hover:scale-105"
        loading="eager"
      />
    </div>
  );
}
