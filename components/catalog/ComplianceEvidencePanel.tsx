'use client';
import { useState } from 'react';
import { businessDate } from '@/lib/catalog/business-date';
import {
  deriveEvidenceStatus,
  EVIDENCE_STATUSES,
  EVIDENCE_STATUS_LABELS,
  EVIDENCE_TYPES,
  EVIDENCE_TYPE_LABELS,
  type ComplianceEvidence,
  type EvidenceInput,
} from '@/lib/catalog/compliance';
import type { Product } from '@/lib/catalog/types';

const blank = (product: Product): EvidenceInput => ({
  type:
    product.kind === 'hardware' || product.kind === 'bundle'
      ? 'hardware_registry'
      : 'software_registry',
  number: '',
  issuer: '',
  sourceUrl: '',
  checkedAt: businessDate(new Date()) ?? '',
  validUntil: null,
  status: 'confirmed',
  applicability: [product.sku, product.edition].filter(Boolean).join('; '),
  note: '',
});

/**
 * Registry entries and certificates of one catalog product. Records are entered
 * manually with source, check date and exact applicability; the displayed status is
 * derived (expired after the validity date, unverified when the check is stale).
 */
export default function ComplianceEvidencePanel({
  product,
  busy,
  mutate,
}: {
  product: Product;
  busy: boolean;
  mutate: (body: unknown, done?: () => void) => Promise<void>;
}) {
  const [form, setForm] = useState<EvidenceInput>(() => blank(product));
  const [editing, setEditing] = useState<ComplianceEvidence | null>(null);
  const today = businessDate(new Date()) ?? '';
  const evidence = product.evidence ?? [];
  const editable = !product.archived && !product.vendor.archived;
  return (
    <details data-testid="compliance-evidence">
      <summary>Реестры и сертификаты ({evidence.length})</summary>
      <p className="text-sm text-slate-500">
        Подтверждения вносятся вручную и автоматически не проверяются. В документах печатаются
        только действующие записи, относящиеся к точной версии/модели подтвержденной позиции;
        наличие бренда соответствие не подтверждает.
      </p>
      <ul className="space-y-1 text-sm">
        {evidence.map((e) => {
          const derived = deriveEvidenceStatus(e, today);
          return (
            <li key={e.id} className="border-t py-1">
              <span
                className={derived.status === 'confirmed' ? 'text-green-700' : 'text-amber-700'}
              >
                {EVIDENCE_STATUS_LABELS[derived.status]}
                {derived.reason ? ` (${derived.reason})` : ''}
              </span>{' '}
              · {EVIDENCE_TYPE_LABELS[e.type]} № {e.number}
              {e.issuer ? ` · ${e.issuer}` : ''} · применимо к: {e.applicability} · проверено{' '}
              {e.checkedAt} ({e.checkedBy}) · действует до {e.validUntil ?? 'не указано'} ·{' '}
              <a
                className="text-blue-600 underline"
                href={e.sourceUrl}
                rel="noreferrer"
                target="_blank"
              >
                источник
              </a>
              {e.note ? ` · ${e.note}` : ''}
              {editable && (
                <>
                  <button
                    className="btn-secondary ml-2"
                    disabled={busy}
                    onClick={() => {
                      setEditing(e);
                      setForm({
                        type: e.type,
                        number: e.number,
                        issuer: e.issuer,
                        sourceUrl: e.sourceUrl,
                        checkedAt: e.checkedAt,
                        validUntil: e.validUntil,
                        status: e.status,
                        applicability: e.applicability,
                        note: e.note,
                      });
                    }}
                  >
                    Изменить
                  </button>
                  <button
                    className="btn-secondary ml-2"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('Архивировать подтверждение? История сохранится.'))
                        void mutate({ action: 'evidence.archive', id: e.id, revision: e.revision });
                    }}
                  >
                    Архивировать
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {editable && (
        <fieldset disabled={busy} className="mt-2 grid gap-2 sm:grid-cols-3">
          <legend className="text-sm font-semibold">
            {editing ? `Изменение подтверждения № ${editing.number}` : 'Новое подтверждение'}
          </legend>
          <label>
            Вид подтверждения
            <select
              className="input w-full"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as EvidenceInput['type'] })}
            >
              {EVIDENCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVIDENCE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Номер записи / сертификата
            <input
              className="input w-full"
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
            />
          </label>
          <label>
            Орган / реестр
            <input
              className="input w-full"
              value={form.issuer}
              onChange={(e) => setForm({ ...form, issuer: e.target.value })}
            />
          </label>
          <label>
            Ссылка на источник
            <input
              className="input w-full"
              value={form.sourceUrl}
              onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
            />
          </label>
          <label>
            Дата проверки
            <input
              type="date"
              className="input w-full"
              value={form.checkedAt}
              onChange={(e) => setForm({ ...form, checkedAt: e.target.value })}
            />
          </label>
          <label>
            Действует до (пусто — не указано)
            <input
              type="date"
              className="input w-full"
              value={form.validUntil ?? ''}
              onChange={(e) => setForm({ ...form, validUntil: e.target.value || null })}
            />
          </label>
          <label>
            Результат проверки
            <select
              className="input w-full"
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as EvidenceInput['status'] })
              }
            >
              {EVIDENCE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {EVIDENCE_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Применимость (точные версии / модели / редакции через «;»)
            <input
              className="input w-full"
              value={form.applicability}
              onChange={(e) => setForm({ ...form, applicability: e.target.value })}
            />
          </label>
          <label>
            Комментарий
            <input
              className="input w-full"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
          <div className="flex gap-2 sm:col-span-3">
            <button
              className="btn-primary"
              disabled={!form.number.trim() || !form.sourceUrl.trim() || !form.applicability.trim()}
              onClick={() =>
                mutate(
                  editing
                    ? {
                        action: 'evidence.update',
                        id: editing.id,
                        revision: editing.revision,
                        evidence: form,
                      }
                    : { action: 'evidence.create', productId: product.id, evidence: form },
                  () => {
                    setEditing(null);
                    setForm(blank(product));
                  },
                )
              }
            >
              Сохранить подтверждение
            </button>
            {editing && (
              <button
                className="btn-secondary"
                onClick={() => {
                  setEditing(null);
                  setForm(blank(product));
                }}
              >
                Отменить
              </button>
            )}
          </div>
        </fieldset>
      )}
    </details>
  );
}
