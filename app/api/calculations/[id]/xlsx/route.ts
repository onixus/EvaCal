import { NextRequest, NextResponse } from "next/server";
import {
  loadCalculationForExport,
  safeFileName,
  contentDisposition,
} from "@/lib/export";
import { renderCalculationXlsx } from "@/lib/xlsx";

// Same visibility as the rest of the archive: no auth required to export a calculation.
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const calc = await loadCalculationForExport(params.id);
  if (!calc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const buffer = renderCalculationXlsx(calc);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDisposition(
        safeFileName(calc.name),
        "xlsx",
      ),
      "Content-Length": String(buffer.length),
    },
  });
}
