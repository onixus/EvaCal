import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import PresaleCalculationEditor from "./PresaleCalculationEditor";

export const dynamic = "force-dynamic";

export default async function PresaleCalculationPage({ params }: { params: { id: string } }) {
  const calculation = await prisma.calculation.findUnique({
    where: { id: params.id },
    include: {
      template: { include: { fields: { orderBy: { order: "asc" } } } },
      stages: { orderBy: { order: "asc" } },
    },
  });
  if (!calculation) notFound();

  return (
    <PresaleCalculationEditor
      calculation={JSON.parse(
        JSON.stringify({ ...calculation, answers: JSON.parse(calculation.answers) })
      )}
    />
  );
}
