'use strict';

/* Run with npm run test:gost34:verify. Exercises real AST and DOCX generation without a database or LLM. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');
const { xml2js } = require('xml-js');
const root = path.join(__dirname, '..');
const { GOLDEN_SCENARIOS } = require(root + '/lib/gost34/__tests__/golden/scenarios.ts');
const { buildGoldenSnapshot } = require(root + '/lib/gost34/__tests__/golden/snapshot.ts');
const { prepareGost34Document } = require(root + '/lib/gost34/generation/prepareDocument.ts');
const { generateGost34Document } = require(root + '/lib/gost34/generation/exportDocument.ts');
const { exportGost34ToDocx } = require(root + '/lib/gost34/exporters/docxExporter.ts');
const { validateSchemaCoverage } = require(root + '/lib/gost34/schema/coverage.ts');
const { Gost34StructureError, UnsupportedGostDocumentTypeError } = require(
  root + '/lib/gost34/generation/errors.ts',
);
const { contentDisposition } = require(root + '/lib/exportResponse.ts');
const { CURRENT_GOST34_PROFILE_ID, LEGACY_GOST34_PROFILE_ID } = require(
  root + '/lib/gost34/standards/index.ts',
);
const { TzAuthorHardFlagsError } = require(root + '/lib/gost34/llm/tzAuthor/validate.ts');
const { buildProjectContext } = require(root + '/lib/gost34/context/builder.ts');
let assertions = 0,
  docs = 0;
function check(fn) {
  fn();
  assertions++;
}
async function xml(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const content = await zip.file('word/document.xml').async('string');
  xml2js(content);
  docs++;
  return content;
}
async function run() {
  for (const scenario of GOLDEN_SCENARIOS) {
    check(() =>
      assert.deepEqual(
        buildGoldenSnapshot(scenario),
        JSON.parse(
          fs.readFileSync(root + '/lib/gost34/__tests__/golden/' + scenario.id + '.json', 'utf8'),
        ),
      ),
    );
    for (const layoutProfileId of ['gost34-modern', 'gost34-eskd-frame', 'plain-corporate']) {
      const input = {
        calculation: scenario.calculation,
        projectContext: scenario.projectContext,
        metadataOverride: {
          docType: scenario.docType,
          standardProfileId: scenario.standardProfileId,
          layoutProfileId,
        },
      };
      const preview = prepareGost34Document(input, {
        mode: 'preview',
      });
      const exported = await generateGost34Document(input);
      check(() => assert.deepEqual(preview.ast, exported.ast));
      check(() => assert.equal(preview.diagnostics.issues.length, 0));
      await xml(exported.buffer);
    }
  }
  for (const standardProfileId of [CURRENT_GOST34_PROFILE_ID, LEGACY_GOST34_PROFILE_ID]) {
    for (const docType of ['TZ', 'PZ', 'AF', 'PMI', 'SPEC', 'RP', 'RA', 'PSI', 'ACT']) {
      for (const layoutProfileId of ['gost34-modern', 'gost34-eskd-frame', 'plain-corporate']) {
        const input = {
          calculation: GOLDEN_SCENARIOS[0].calculation,
          metadataOverride: {
            docType,
            standardProfileId,
            layoutProfileId,
          },
        };
        const exported = await generateGost34Document(input);
        check(() => assert.equal(exported.ast.metadata.docType, docType));
        await xml(exported.buffer);
      }
    }
  }
  for (const value of ['BOGUS', 'constructor', '__proto__'])
    check(() =>
      assert.throws(
        () =>
          prepareGost34Document({
            metadataOverride: {
              docType: value,
            },
          }),
        UnsupportedGostDocumentTypeError,
      ),
    );
  const overrides = {
    'tz2020-general': {
      paragraphs: [' ', '1.1 '],
    },
  };
  const preview = prepareGost34Document(
    {
      sectionOverrides: overrides,
    },
    {
      mode: 'preview',
    },
  );
  check(() =>
    assert(
      preview.diagnostics.issues.some((i) => i.nodeId === 'tz2020-general' && i.kind === 'empty'),
    ),
  );
  check(() => assert(preview.baselineAst.sections[0].paragraphs.length > 0));
  check(() =>
    assert.throws(
      () =>
        prepareGost34Document({
          sectionOverrides: overrides,
        }),
      Gost34StructureError,
    ),
  );
  const schema = {
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
            children: [
              {
                id: 'deep',
                title: 'Deep',
                required: true,
              },
            ],
          },
          {
            id: 'b',
            title: 'B',
            required: true,
          },
        ],
      },
    ],
  };
  const sec = (id, subsections) => ({
    id,
    title: id,
    numStr: '1',
    paragraphs: ['Text'],
    subsections,
  });
  const findings = validateSchemaCoverage(schema, [sec('root', [sec('b'), sec('a')])]);
  check(() => assert(findings.some((i) => i.nodeId === 'b' && i.kind === 'out-of-order')));
  check(() => assert(findings.some((i) => i.nodeId === 'deep' && i.kind === 'missing')));
  const ast = prepareGost34Document({
    metadataOverride: {
      layoutProfileId: 'plain-corporate',
    },
  }).ast;
  ast.sections = [
    sec('body', [sec('sub', [sec('deep')])]),
    ...['А', 'Б'].map((letter) => ({
      ...sec(letter),
      numStr: 'Приложение ' + letter,
      tables: [
        {
          caption: 'Caption ' + letter,
          headers: ['H'],
          rows: [['V']],
        },
      ],
    })),
  ];
  const content = await xml(await exportGost34ToDocx(ast));
  check(() => assert(content.includes('w:val="Heading3"')));
  check(() => assert(content.includes('А.1')));
  check(() => assert(content.includes('Б.1')));
  check(() => assert(!content.includes('Б.2')));
  check(() => assert(!content.includes('Иванов') && !content.includes('Петров')));
  check(() => assert(Object.values(ast.metadata.signatures).every((v) => v === '')));
  const header = contentDisposition('ТЗ Система', 'docx');
  check(() =>
    assert.equal(
      new Headers({
        'Content-Disposition': header,
      }).get('Content-Disposition'),
      header,
    ),
  );
  const state = {
    promptVersion: 'tz-author-v1',
    speculateDefault: false,
    proposals: {
      'tz2020-general': {
        nodeId: 'tz2020-general',
        status: 'ACCEPTED',
        paragraphs: ['Система должна соответствовать Приказу ФСТЭК России № 21.'],
        speculate: false,
        flags: [],
      },
    },
  };
  const params = {
    calculation: {
      name: 'Тест',
      answers: {
        personalData: false,
        securitySignificant: false,
        criticalInfra: false,
      },
      stages: [],
      risks: [],
    },
    tzAuthor: state,
  };
  check(() => assert.throws(() => prepareGost34Document(params), TzAuthorHardFlagsError));
  check(() =>
    assert(
      prepareGost34Document(params, {
        mode: 'preview',
      }).tzAuthorDiagnostics.length > 0,
    ),
  );
  const security = buildProjectContext({
    answers: {
      ngfw_clusters_count: 2,
      vpn_tunnels_count: 5,
    },
  }).security;
  check(() => assert.equal(security?.personalDataProcessed, undefined));
  check(() => assert.equal(security?.regulatoryScope, undefined));
  const funding = prepareGost34Document({
    projectContext: {
      funding: 'Средства Заказчика, оплата по этапам',
    },
  });
  check(() =>
    assert(JSON.stringify(funding.ast.sections).includes('Средства Заказчика, оплата по этапам')),
  );
  check(() => assert(!funding.diagnostics.gaps.some((g) => g.path === 'funding')));
  const incomplete = prepareGost34Document({});
  check(() => assert(incomplete.diagnostics.gaps.some((g) => g.path === 'funding')));
  console.log(
    JSON.stringify({
      assertions,
      documents: docs,
      goldenScenarios: GOLDEN_SCENARIOS.length,
      result: 'PASS',
    }),
  );
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
