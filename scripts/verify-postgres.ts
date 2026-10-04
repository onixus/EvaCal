/** Integration check against an explicitly configured, migrated PostgreSQL DB. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { containsInsensitive } from '../lib/textSearch';

async function main() {
  const [server] = await prisma.$queryRaw<{ version: string }[]>`SELECT version()`;
  assert.match(server.version, /PostgreSQL/);
  const marker = randomUUID();
  const rollback = new Error('intentional integration-check rollback');
  try {
    await prisma.$transaction(async (tx) => {
      const template = await tx.formTemplate.create({ data: { name: `Банк-${marker}` } });
      const found = await tx.formTemplate.findFirst({
        where: { id: template.id, name: containsInsensitive(`банк-${marker}`) },
      });
      assert.equal(found?.id, template.id, 'case-insensitive Cyrillic search must find the row');
      await tx.formField.create({
        data: {
          templateId: template.id,
          label: 'integration probe',
          key: marker,
          type: 'text',
        },
      });
      await tx.formTemplate.delete({ where: { id: template.id } });
      assert.equal(
        await tx.formField.count({ where: { templateId: template.id } }),
        0,
        'FK cascade',
      );
      await tx.formTemplate.create({ data: { name: `rollback-${marker}` } });
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await prisma.formTemplate.count({ where: { name: `rollback-${marker}` } }), 0);
  console.log(
    'PostgreSQL integration passed: CRUD, Cyrillic ILIKE, FK cascade, transaction rollback.',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
