import Link from "next/link";
import { prisma } from "@/lib/prisma";
import NewCalculationForm from "./NewCalculationForm";

export const dynamic = "force-dynamic";

export default async function PresalePage() {
  const template = await prisma.formTemplate.findFirst({
    where: { isActive: true },
    include: { fields: { orderBy: { order: "asc" } } },
  });

  const drafts = await prisma.calculation.findMany({
    where: { createdBy: "presale" },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { stages: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Интерфейс пресейла</h1>
        <p className="text-sm text-slate-500">
          Заполните опросник — этапы и трудозатраты в человеко-часах рассчитаются автоматически.
        </p>
      </div>

      {!template ? (
        <div className="card p-6 text-slate-600">
          Нет активного шаблона опросника. Создайте и активируйте шаблон в{" "}
          <Link href="/admin" className="text-brand-700 underline">
            интерфейсе администратора
          </Link>
          .
        </div>
      ) : (
        <div className="card p-6">
          <NewCalculationForm template={JSON.parse(JSON.stringify(template))} />
        </div>
      )}

      {drafts.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-3 font-medium">Недавние расчёты пресейла</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {drafts.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2">
                <Link href={`/presale/${d.id}`} className="text-brand-700 hover:underline">
                  {d.name} — {d.customer}
                </Link>
                <span className="text-xs text-slate-500">{d.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
