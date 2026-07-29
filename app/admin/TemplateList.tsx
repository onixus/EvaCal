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

  async function activate(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/templates/${id}/activate`, { method: "POST" });
      router.refresh();
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
              <Link href={`/admin/${t.id}`} className="font-medium text-brand-700 hover:underline">
                {t.name}
              </Link>
              {t.description && <p className="text-xs text-slate-500">{t.description}</p>}
            </td>
            <td className="py-2 pr-4">{t._count.fields}</td>
            <td className="py-2 pr-4">{t._count.stageTemplates}</td>
            <td className="py-2 pr-4">{t._count.calculations}</td>
            <td className="py-2 pr-4">
              {t.isActive ? (
                <span className="badge bg-emerald-100 text-emerald-700">Активен</span>
              ) : (
                <button className="btn-secondary px-2 py-1 text-xs" disabled={busy === t.id} onClick={() => activate(t.id)}>
                  Сделать активным
                </button>
              )}
            </td>
            <td className="py-2 pr-4">
              <Link href={`/admin/${t.id}`} className="btn-secondary px-3 py-1 text-xs">
                Редактировать
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
