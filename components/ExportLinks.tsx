"use client";

import { useState } from "react";
import VendorSpecUploadModal from "./gost34/VendorSpecUploadModal";

export default function ExportLinks({
  calculationId,
}: {
  calculationId: string;
}) {
  const [isGostModalOpen, setIsGostModalOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => setIsGostModalOpen(true)}
          className="btn-secondary font-medium text-nord-accent border-nord-accent/40 hover:border-nord-accent"
          title="Конструктор ГОСТ 34: загрузка вендорского ТЗ и рамки ГОСТ 2.104"
        >
          ГОСТ 34 Конструктор
        </button>
        <a
          href={`/api/calculations/${calculationId}/pdf`}
          className="btn-secondary"
        >
          PDF
        </a>
        <a
          href={`/api/calculations/${calculationId}/xlsx`}
          className="btn-secondary"
        >
          XLSX
        </a>
        <a
          href={`/api/calculations/${calculationId}/json`}
          className="btn-secondary"
        >
          JSON
        </a>
      </div>

      <VendorSpecUploadModal
        calculationId={calculationId}
        isOpen={isGostModalOpen}
        onClose={() => setIsGostModalOpen(false)}
      />
    </>
  );
}
