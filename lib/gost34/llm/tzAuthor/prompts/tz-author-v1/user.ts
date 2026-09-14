import { GroundingPack } from '../../grounding';

export function buildUserPrompt(pack: GroundingPack): string {
  const parts: string[] = [];

  parts.push('<grounding>');
  parts.push(`  <node id="${pack.node.id}" title="${pack.node.title}" numStr="${pack.node.numStr}" leadInOnly="${pack.node.leadInOnly}" speculate="${pack.speculate}" />`);

  parts.push('  <allowed_citations>');
  for (const text of pack.allowedCitationTexts) {
    parts.push(`    <citation text="${text}" />`);
  }
  parts.push('  </allowed_citations>');

  parts.push('  <applicability>');
  for (const app of pack.applicability) {
    parts.push(`    <standard id="${app.standardId}" title="${app.title}" status="${app.finalStatus}" />`);
  }
  parts.push('  </applicability>');

  if (Object.keys(pack.contextSlice).length > 0) {
    parts.push('  <untrusted source="context">');
    parts.push(JSON.stringify(pack.contextSlice, null, 2));
    parts.push('  </untrusted>');
  }

  if (pack.requirements.length > 0) {
    parts.push('  <untrusted source="requirements">');
    parts.push(JSON.stringify(pack.requirements, null, 2));
    parts.push('  </untrusted>');
  }

  if (pack.calculationFacts) {
    parts.push('  <untrusted source="calculation">');
    parts.push(JSON.stringify(pack.calculationFacts, null, 2));
    parts.push('  </untrusted>');
  }

  if (pack.baseline.paragraphs.length > 0 || pack.baseline.gaps.length > 0) {
    parts.push('  <baseline>');
    if (pack.baseline.paragraphs.length > 0) {
      parts.push('    <paragraphs>');
      for (const p of pack.baseline.paragraphs) {
        parts.push(`      <p>${p}</p>`);
      }
      parts.push('    </paragraphs>');
    }
    if (pack.baseline.tableCaptions.length > 0) {
      parts.push('    <tables>');
      for (const t of pack.baseline.tableCaptions) {
        parts.push(`      <caption>${t}</caption>`);
      }
      parts.push('    </tables>');
    }
    if (pack.baseline.gaps.length > 0) {
      parts.push('    <gaps>');
      for (const g of pack.baseline.gaps) {
        parts.push(`      <gap path="${g.path}" label="${g.label}" hint="${g.hint || ''}" />`);
      }
      parts.push('    </gaps>');
    }
    parts.push('  </baseline>');
  }

  parts.push('</grounding>');
  parts.push(`\nПодготовь текст раздела "${pack.node.title}" (nodeId: "${pack.node.id}") строго по схеме JSON.`);

  return parts.join('\n');
}
