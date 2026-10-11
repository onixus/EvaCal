/**
 * Общего `app/admin/layout.tsx` больше нет: экраны администратора лежат в
 * группе `app/admin/(core)` (только admin), библиотека решений — в
 * `app/admin/solution-kits` (admin и architect). Страница, положенная прямо в
 * `app/admin` или в новую папку без своего layout, открылась бы без проверки
 * роли. Тест требует, чтобы у каждой страницы под `app/admin` был охраняющий
 * layout (с `requireRole(`) в одной из папок между ней и `app/admin`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ADMIN_DIR = path.resolve(__dirname, '../../app/admin');

function pages(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pages(full);
    return /^page\.(tsx|ts|jsx|js)$/.test(entry.name) ? [full] : [];
  });
}

function guardingLayout(dir: string): string | null {
  for (const name of ['layout.tsx', 'layout.ts', 'layout.jsx', 'layout.js']) {
    const file = path.join(dir, name);
    if (fs.existsSync(file) && /requireRole\(/.test(fs.readFileSync(file, 'utf8'))) return file;
  }
  return null;
}

describe('защита страниц /admin', () => {
  const all = pages(ADMIN_DIR);

  it('страницы найдены', () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it('у каждой страницы есть охраняющий layout ниже app/admin', () => {
    const unguarded = all.filter((page) => {
      let dir = path.dirname(page);
      while (dir !== ADMIN_DIR && dir.startsWith(ADMIN_DIR)) {
        if (guardingLayout(dir)) return false;
        dir = path.dirname(dir);
      }
      // Охрана на уровне самого app/admin тоже годится, если её вернут.
      return !guardingLayout(ADMIN_DIR);
    });
    expect(unguarded.map((p) => path.relative(ADMIN_DIR, p))).toEqual([]);
  });

  it('экраны администратора — только admin, библиотека — admin и architect', () => {
    const core = fs.readFileSync(path.join(ADMIN_DIR, '(core)/layout.tsx'), 'utf8');
    expect(core).toMatch(/requireRole\('admin'/);
    const kits = fs.readFileSync(path.join(ADMIN_DIR, 'solution-kits/layout.tsx'), 'utf8');
    expect(kits).toMatch(/KIT_LIBRARY_ROLES/);
  });
});
