import mammoth from 'mammoth';
import { Gost34RequirementItem, RequirementCategory } from '../types';

export interface ParsedVendorDocument {
  filename: string;
  rawText: string;
  extractedRequirements: Gost34RequirementItem[];
}

/**
 * Parses vendor files (.docx, .txt, .md, .json) and extracts structured requirements
 */
export async function parseVendorDocument(
  buffer: Buffer,
  filename: string,
): Promise<ParsedVendorDocument> {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  let rawText = '';

  if (ext === 'docx') {
    try {
      const result = await mammoth.extractRawText({ buffer });
      rawText = result.value || '';
    } catch (e) {
      rawText = buffer.toString('utf-8');
    }
  } else if (ext === 'json') {
    const str = buffer.toString('utf-8');
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) {
        rawText = parsed.map((item) => JSON.stringify(item)).join('\n');
      } else {
        rawText = str;
      }
    } catch (e) {
      rawText = str;
    }
  } else {
    // .txt, .md, etc.
    rawText = buffer.toString('utf-8');
  }

  const extractedRequirements = extractRequirementsFromText(rawText, filename);

  return {
    filename,
    rawText,
    extractedRequirements,
  };
}

/**
 * Heuristic requirement extraction logic from vendor specification text.
 * Enhanced with full IT, Cybersecurity (ИБ), Software Supply, Hardware/PAC, and Infrastructure categories.
 */
export function extractRequirementsFromText(
  text: string,
  sourceFile: string,
): Gost34RequirementItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const requirements: Gost34RequirementItem[] = [];
  let reqIndex = 1;

  let currentCategory: RequirementCategory = 'functional';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect section categories
    if (
      /пак|программно-аппаратн|сервер|схд|оборудован|стойк|шкаф|коммутатор|маршрутизатор|ибп|apc|yadro|аквариус|aquarius|fplus|скала|depo|гравитон|kraftway|qtech|eltex|cisco|huawei|dell|hpe|lenovo|supermicro|san|nas|raid|nvme|скс|зип/i.test(
        line,
      )
    ) {
      currentCategory = 'hardware_pac';
    } else if (
      /безопасн|иб|сзи|скзи|нсд|шифр|152-фз|187-фз|кии|фстэк|фсб|гост-vpn|криптопро|vipnet|континент|соболь|secret net|dallas lock|usergate|kaspersky|cyberpeak|positive technologies|maxpatrol|ngfw|waf|siem|аттестац|модель угроз|орд/i.test(
        line,
      )
    ) {
      currentCategory = 'security';
    } else if (
      /поставк.*по|лицензи|сублиценз|реестр.*(программ|по|188-фз)|дистрибутив|формуляр|сертификат.*подлинност/i.test(
        line,
      )
    ) {
      currentCategory = 'software_supply';
    } else if (
      /интеграц|api|шлюз|rest|soap|graphql|grpc|kafka|rabbitmq|1с|смэв|еаис|esb|etl|обмен.*данн/i.test(
        line,
      )
    ) {
      currentCategory = 'integration';
    } else if (
      /монтаж|пнр|пусконалад|настройк.*ос|astra linux|ред ос|альт линукс|субд|postgresql|postgres pro|виртуализац|zvirt|vmmanager|kubernetes|docker|freeipa|active directory|резервн.*копирован|бэкап|киберпротект|rubackup/i.test(
        line,
      )
    ) {
      currentCategory = 'infra_setup';
    } else if (/производительн|нагруз|откли|время реакц|tps|масштабируем/i.test(line)) {
      currentCategory = 'performance';
    } else if (/надежн|отказоустойч|резерв|восстановл|sla|rto|rpo|кластер/i.test(line)) {
      currentCategory = 'reliability';
    } else if (/интерфейс|эргоном|удобств|wcag|экран|форма|дизайн/i.test(line)) {
      currentCategory = 'ergonomics';
    } else if (/испытан|пми|приемк|тестирован|опытн.*эксплуатац/i.test(line)) {
      currentCategory = 'testing_acceptance';
    } else if (/обучен|персонал|руководств|сопровожден|техподдержк/i.test(line)) {
      currentCategory = 'training_support';
    }

    // Match requirement pattern (e.g. "ТР-Ф-01", "1.1.", "Система должна...", "Требование к...")
    const isExplicitCode = /(ТР|ФТ|ТТ|БР|REQ|REQ-)[-A-Za-z0-9_.]+/i.test(line);
    const isRequirementSentence =
      /должн(а|о|ы)|обязан(а|о|ы)|требование|обеспечивает|поставляется|монтируется|настраивается/i.test(
        line,
      );

    if ((isExplicitCode || isRequirementSentence) && line.length > 15) {
      // Extract code if present or generate standard code
      const codeMatch = line.match(/(ТР|ФТ|ТТ|БР|REQ)[-A-Za-z0-9_.]+/i);
      const code = codeMatch
        ? codeMatch[0].toUpperCase()
        : `ТР-ВЕНД-${String(reqIndex).padStart(2, '0')}`;

      // Clean up tab stops and multiple spaces
      const cleanLine = line.replace(/\t+/g, ' ').replace(/\s+/g, ' ').trim();

      const title = cleanLine;
      const description = cleanLine;

      requirements.push({
        id: `req-vendor-${reqIndex}`,
        code,
        category: currentCategory,
        title,
        description,
        sourceFile,
      });

      reqIndex++;
    }
  }

  // Fallback: If no explicit requirements found, split text into logical paragraphs as requirements
  if (requirements.length === 0 && lines.length > 0) {
    let pIdx = 1;
    for (const line of lines) {
      if (line.length > 20) {
        requirements.push({
          id: `req-vendor-${pIdx}`,
          code: `ТР-ВЕНД-${String(pIdx).padStart(2, '0')}`,
          category: 'functional',
          title: line,
          description: line,
          sourceFile,
        });
        pIdx++;
      }
    }
  }

  return requirements;
}
