'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const splitList = (s: string) =>
  s
    .split(/[;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Создание набора: паспорт и пустой черновик v1; создатель — владелец. */
export default function NewKitForm() {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [industries, setIndustries] = useState('');
  const [productTypes, setProductTypes] = useState('');
  const [notes, setNotes] = useState('');
  const [source, setSource] = useState('manual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/solution-kits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: key.trim(),
        name,
        source,
        scope: { industries: splitList(industries), productTypes: splitList(productTypes), notes },
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? 'Не удалось создать набор');
      return;
    }
    router.push(`/admin/solution-kits/${data.kit.id}`);
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-6">
      <label className="sm:col-span-2">
        <span className="label">Ключ (латиница, стабильный)</span>
        <input
          className="input"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="ngfw.branch-office"
          required
        />
      </label>
      <label className="sm:col-span-4">
        <span className="label">Название</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="sm:col-span-2">
        <span className="label">Отрасли (через «;»)</span>
        <input
          className="input"
          value={industries}
          onChange={(e) => setIndustries(e.target.value)}
        />
      </label>
      <label className="sm:col-span-2">
        <span className="label">Типы продуктов (через «;»)</span>
        <input
          className="input"
          value={productTypes}
          onChange={(e) => setProductTypes(e.target.value)}
        />
      </label>
      <label className="sm:col-span-2">
        <span className="label">Источник</span>
        <input className="input" value={source} onChange={(e) => setSource(e.target.value)} />
      </label>
      <label className="sm:col-span-5">
        <span className="label">Условия применимости</span>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="flex items-end">
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          Создать
        </button>
      </div>
      {error && <p className="text-xs text-rose-700 sm:col-span-6">{error}</p>}
    </form>
  );
}
