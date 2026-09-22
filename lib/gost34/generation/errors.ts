import type { SchemaValidationIssue } from '../schema/types';

export class Gost34StructureError extends Error {
  readonly code = 'gost34_invalid_structure';
  readonly statusCode = 409;
  readonly issues: SchemaValidationIssue[];
  constructor(issues: SchemaValidationIssue[]) {
    super('Итоговая структура ТЗ содержит незаполненные или нарушенные обязательные разделы.');
    this.name = 'Gost34StructureError';
    this.issues = issues;
  }
}

export class UnsupportedGostDocumentTypeError extends Error {
  readonly code = 'gost34_unsupported_document_type';
  readonly statusCode = 400;
  constructor(docType: unknown) {
    super(`Неподдерживаемый тип документа ГОСТ 34: ${String(docType)}`);
    this.name = 'UnsupportedGostDocumentTypeError';
  }
}
