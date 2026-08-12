'use client';

import { useState } from 'react';
import Gost34WizardModal from './gost34/Gost34WizardModal';

export default function ExportLinks({ calculationId }: { calculationId: string }) {
  const [isGostModalOpen, setIsGostModalOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => setIsGostModalOpen(true)}
          className="btn-secondary font-medium text-nord-accent border-nord-accent/40 hover:border-nord-accent"
          title="Мастер ГОСТ 34: профиль, требования, применимость, трассируемость и выпуск"
        >
          Мастер ГОСТ 34
        </button>
        <a href={`/api/calculations/${calculationId}/pdf`} className="btn-secondary">
          PDF
        </a>
        <a href={`/api/calculations/${calculationId}/xlsx`} className="btn-secondary">
          XLSX
        </a>
        <a href={`/api/calculations/${calculationId}/json`} className="btn-secondary">
          JSON
        </a>
      </div>

      <Gost34WizardModal
        calculationId={calculationId}
        isOpen={isGostModalOpen}
        onClose={() => setIsGostModalOpen(false)}
      />
    </>
  );
}
