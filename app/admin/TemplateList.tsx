"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Template {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  _count: { fields: number; stageTemplates: number; calculations: number };
}

export default function TemplateList({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  async function activate(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/templates/${id}/activate`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function rename(id: string, name: string, currentName: string) {
    setRenamingId(null);
    if (!name.trim() || name === currentName) return;
    setBusy(id);
    try {
      await fetch(`/api/templates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function duplicate(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/templates/${id}/duplicate`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push(`/admin/${data.id}`);
      } else {
        alert(data.error ?? "Ошибка запроса");
      }
    } finally {
      setBusy(null);
    }
  }

  if (templates.length === 0) {
    return <p className="text-sm text-slate-500">Пока нет шаблонов.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
          <th className="py-2 pr-4">Шаблон</th>
          <th className="py-2 pr-4">Вопросов</th>
          <th className="py-2 pr-4">Этапов</th>
          <th className="py-2 pr-4">Расчётов</th>
          <th className="py-2 pr-4">Активен</th>
          <th className="py-2 pr-4" />
        </tr>
      </thead>
      <tbody>
        {templates.map((t) => (
          <tr key={t.id} className="border-b border-slate-100 last:border-0">
            <td className="py-2 pr-4">
              {renamingId === t.id ? (
                <input
                  className="input w-56"
                  autoFocus
                  defaultValue={t.name}
                  disabled={busy === t.id}
                  onBlur={(e) => rename(t.id, e.target.value, t.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <Link
                    href={`/admin/${t.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {t.name}
                  </Link>
                  <button
                    className="text-xs text-slate-400 hover:text-slate-600"
                    title="Переименовать"
                    onClick={() => setRenamingId(t.id)}
                  >
                    ✎
                  </button>
                </div>
              )}
              {t.description && (
                <p className="text-xs text-slate-500">{t.description}</p>
              )}
            </td>
            <td className="py-2 pr-4">{t._count.fields}</td>
            <td className="py-2 pr-4">{t._count.stageTemplates}</td>
            <td className="py-2 pr-4">{t._count.calculations}</td>
            <td className="py-2 pr-4">
              {t.isActive ? (
                <span className="badge bg-emerald-100 text-emerald-700">
                  Активен
                </span>
              ) : (
                <button
                  className="btn-secondary px-2 py-1 text-xs"
                  disabled={busy === t.id}
                  onClick={() => activate(t.id)}
                >
                  Сделать активным
                </button>
              )}
            </td>
            <td className="py-2 pr-4">
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/${t.id}`}
                  className="btn-secondary px-3 py-1 text-xs"
                >
                  Редактировать
                </Link>
                <button
                  className="btn-secondary px-3 py-1 text-xs"
                  disabled={busy === t.id}
                  onClick={() => duplicate(t.id)}
                >
                  Копировать
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
