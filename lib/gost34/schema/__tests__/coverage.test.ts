import { describe, expect, it } from 'vitest';
import { validateSchemaCoverage } from '../coverage';
import type { DocumentSchema } from '../types';
import type { Gost34Section } from '../../types';

const schema: DocumentSchema = {
  id: 's',
  profileId: 'p',
  nodes: [
    {
      id: 'root',
      title: 'Root',
      required: true,
      children: [
        {
          id: 'a',
          title: 'A',
          required: true,
          children: [{ id: 'deep', title: 'Deep', required: true }],
        },
        { id: 'b', title: 'B', required: true },
        { id: 'optional', title: 'Optional' },
      ],
    },
  ],
};
const section = (id: string, subsections?: Gost34Section[]): Gost34Section => ({
  id,
  title: id,
  numStr: '1',
  paragraphs: ['Text'],
  subsections,
});

describe('Recursive schema coverage', () => {
  it('detects reversed siblings and missing grandchildren', () => {
    const issues = validateSchemaCoverage(schema, [section('root', [section('b'), section('a')])]);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: 'b', kind: 'out-of-order' }),
        expect.objectContaining({ nodeId: 'deep', kind: 'missing' }),
      ]),
    );
    expect(issues.some((i) => i.nodeId === 'optional')).toBe(false);
  });

  it('accepts a populated tree without optional sections', () => {
    expect(
      validateSchemaCoverage(schema, [
        section('root', [section('a', [section('deep')]), section('b')]),
      ]),
    ).toEqual([]);
  });

  it('detects whitespace-only content and empty headings after editing', () => {
    const leafSchema: DocumentSchema = {
      id: 's',
      profileId: 'p',
      nodes: [schema.nodes[0].children![1]],
    };
    for (const edited of [
      { ...section('b'), paragraphs: [' '] },
      { ...section('b'), title: ' ' },
    ]) {
      expect(validateSchemaCoverage(leafSchema, [edited])).toContainEqual(
        expect.objectContaining({ nodeId: 'b', kind: 'empty' }),
      );
    }
  });

  it('accepts table-only sections', () => {
    const leafSchema: DocumentSchema = {
      id: 's',
      profileId: 'p',
      nodes: [schema.nodes[0].children![1]],
    };
    expect(
      validateSchemaCoverage(leafSchema, [
        { ...section('b'), paragraphs: [], tables: [{ headers: ['Column'], rows: [['Value']] }] },
      ]),
    ).toEqual([]);
  });
});
