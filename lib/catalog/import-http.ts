import { NextResponse } from 'next/server';
import { SpecificationError } from '../specification/validation';
export function importError(error: unknown) {
  const status =
    error instanceof SpecificationError
      ? error.statusCode
      : error instanceof SyntaxError || error instanceof TypeError
        ? 400
        : 500;
  return NextResponse.json(
    { error: status === 500 ? 'Ошибка импорта GPL' : (error as Error).message },
    { status },
  );
}
