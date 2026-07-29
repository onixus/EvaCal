import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { renderCalculationPdf } from "@/lib/pdf";

// Same visibility as the rest of the archive: no auth required to export a calculation.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const calculation = await prisma.calculation.findUnique({
    where: { id: params.id },
    include: {
      template: { include: { fields: { orderBy: { order: "asc" } } } },
      stages: { orderBy: { order: "asc" } },
      risks: { orderBy: { order: "asc" } },
    },
  });
  if (!calculation) return NextResponse.json({ error: "not found" }, { status: 404 });

  const doc = renderCalculationPdf({
    name: calculation.name,
    customer: calculation.customer,
    status: calculation.status,
    startDate: calculation.startDate,
    pmHours: calculation.pmHours,
    templateName: calculation.template.name,
    answers: JSON.parse(calculation.answers),
    fields: calculation.template.fields,
    stages: calculation.stages,
    risks: calculation.risks,
  });

  const chunks: Buffer[] = [];
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });

  const safeName = calculation.name.replace(/[^\p{L}\p{N}\- _]/gu, "").trim() || "calculation";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="calculation.pdf"; filename*=UTF-8''${encodeURIComponent(
        safeName
      )}.pdf`,
      "Content-Length": String(buffer.length),
    },
  });
}
