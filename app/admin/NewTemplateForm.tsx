'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewTemplateForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const data = await res.json();
      if (res.ok) router.push(`/admin/${data.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[220px]">
        <label className="label">Название шаблона</label>
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex-1 min-w-[220px]">
        <label className="label">Описание (необязательно)</label>
        <input
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <button type="submit" className="btn-primary" disabled={submitting}>
        Создать
      </button>
    </form>
  );
}
