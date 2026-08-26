'use client';

import { useState } from 'react';
import type { Gost34RequirementItem } from '@/lib/gost34/types';

interface ManualRequirementFormProps {
  requirementsCount: number;
  onAddRequirement: (req: Gost34RequirementItem) => void;
}

export default function ManualRequirementForm({
  requirementsCount,
  onAddRequirement,
}: ManualRequirementFormProps) {
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !desc.trim()) return;

    onAddRequirement({
      id: `req-manual-${Date.now()}`,
      code: code.trim() || `ТР-ВЕНД-${String(requirementsCount + 1).padStart(2, '0')}`,
      category: 'functional',
      title: title.trim(),
      description: desc.trim(),
      sourceFile: 'Ручной ввод',
    });

    setCode('');
    setTitle('');
    setDesc('');
  };

  return (
    <div className="pt-2">
      <label className="block text-xs font-bold text-slate-600 dark:text-nord-4 mb-2">
        Добавить требование вручную:
      </label>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input
          type="text"
          placeholder="Код (ТР-Ф-01)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="bg-slate-50 dark:bg-nord-1 border border-slate-300 dark:border-nord-3 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-nord-6 placeholder-slate-400 focus:border-brand-500 focus:outline-none"
        />
        <input
          type="text"
          placeholder="Название пункта ТЗ"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="bg-slate-50 dark:bg-nord-1 border border-slate-300 dark:border-nord-3 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-nord-6 placeholder-slate-400 focus:border-brand-500 focus:outline-none"
        />
        <input
          type="text"
          placeholder="Полный текст требования"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          className="bg-slate-50 dark:bg-nord-1 border border-slate-300 dark:border-nord-3 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-nord-6 placeholder-slate-400 focus:border-brand-500 focus:outline-none"
        />
        <button
          type="submit"
          className="bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg px-4 py-2 text-xs shadow-md transition-all cursor-pointer"
        >
          + Добавить пункт
        </button>
      </form>
    </div>
  );
}
