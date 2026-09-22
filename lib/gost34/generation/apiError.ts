import { NextResponse } from 'next/server';
import { TzAuthorHardFlagsError } from '../llm/tzAuthor/validate';
import { Gost34StructureError, UnsupportedGostDocumentTypeError } from './errors';

/** Domain failures keep the same status and payload across preview and download routes. */
export function gost34ErrorResponse(error: unknown) {
  if (error instanceof TzAuthorHardFlagsError) {
    return NextResponse.json({ error: error.code, nodes: error.nodes }, { status: error.statusCode });
  }
  if (error instanceof Gost34StructureError) {
    return NextResponse.json({ error: error.code, issues: error.issues }, { status: error.statusCode });
  }
  if (error instanceof UnsupportedGostDocumentTypeError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.statusCode });
  }
  return null;
}
