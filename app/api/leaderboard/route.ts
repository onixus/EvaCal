import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/apiHelpers';
import { parsePeriod } from '@/lib/leaderboard';
import { loadLeaderboard } from '@/lib/leaderboardData';

export const dynamic = 'force-dynamic';

/**
 * Открытый рейтинг эффективности пресейлов и архитекторов.
 *
 * Намеренно без авторизации: это командный дашборд для общего экрана. Наружу
 * уходят только логины сотрудников и агрегированные счётчики — ни одного
 * названия расчёта, заказчика или суммы сметы (см. `lib/leaderboard.ts`).
 *
 * `?period=30|90|365|all` — окно по дате создания расчёта / комплекта.
 */
export async function GET(req: NextRequest) {
  try {
    const period = parsePeriod(req.nextUrl.searchParams.get('period'));
    const board = await loadLeaderboard(period);
    return NextResponse.json(board, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  } catch (err) {
    return handleApiError(err, 'Failed to build leaderboard', 500);
  }
}
