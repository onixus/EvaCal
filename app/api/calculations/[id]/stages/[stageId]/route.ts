import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ALLOWED_STATUSES = ["planned", "in_progress", "done", "approved", "rejected"];

// Lightweight status update only — dates/hours are owned by the stage-rebuild flow.
export async function PATCH(req: NextRequest, { params }: { params: { id: string; stageId: string } }) {
  const body = await req.json();
  if (!ALLOWED_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }
  const stage = await prisma.stage.update({
    where: { id: params.stageId },
    data: { status: body.status },
  });
  return NextResponse.json(stage);
}
