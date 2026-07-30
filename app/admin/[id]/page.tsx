import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import TemplateEditor from "./TemplateEditor";

export const dynamic = "force-dynamic";

export default async function AdminTemplatePage({ params }: { params: { id: string } }) {
  const template = await prisma.formTemplate.findUnique({
    where: { id: params.id },
    include: {
      fields: { orderBy: { order: "asc" } },
      stageTemplates: { orderBy: { order: "asc" } },
      riskTemplates: { orderBy: { order: "asc" } },
    },
  });
  if (!template) notFound();

  return <TemplateEditor template={JSON.parse(JSON.stringify(template))} />;
}
