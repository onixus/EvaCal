export default function ExportLinks({ calculationId }: { calculationId: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
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
  );
}
