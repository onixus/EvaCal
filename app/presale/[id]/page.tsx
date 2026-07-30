import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import PresaleCalculationEditor from "./PresaleCalculationEditor";

export const dynamic = "force-dynamic";

export default async function PresaleCalculationPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const calculation = await prisma.calculation.findUnique({
    where: { id: params.id },
    include: {
      template: { include: { fields: { orderBy: { order: "asc" } } } },
      stages: { orderBy: { order: "asc" } },
      risks: { orderBy: { order: "asc" } },
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
