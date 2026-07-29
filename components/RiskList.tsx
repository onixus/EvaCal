import { RiskRow } from "./TotalsSummary";

export default function RiskList({ risks }: { risks: RiskRow[] }) {
  if (risks.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-nord-3">Риски не зафиксированы.</p>;
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {risks.map((risk) => (
        <li key={risk.id} className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 p-2 dark:border-nord-2">
          <span>{risk.description}</span>
          <span className="shrink-0 font-medium">{risk.hours} ч</span>
        </li>
      ))}
    </ul>
  );
}
