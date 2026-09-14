import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Регрессия на P2028 «Transaction not found».
 *
 * Клиент кэшировался только под `NODE_ENV !== 'production'`, а прокси читает
 * его на каждое обращение к свойству. В проде это означало новый PrismaClient
 * с новым соединением на каждое обращение: интерактивная транзакция стартовала
 * на одном соединении, а продолжалась на других, и Prisma отвечала P2028.
 * В dev кэш был, поэтому баг не воспроизводился ни локально, ни в юнитах —
 * только в прод-сборке, где его и поймал сквозной тест.
 *
 * Проверяется именно поведение в production: в dev тест прошёл бы и на
 * сломанном коде.
 */
describe('prisma client', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evacal-prisma-'));
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', `file:${path.join(dir, 'test.db')}`);
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    delete (globalThis as { prisma?: unknown }).prisma;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('переиспользует один клиент в production, а не создаёт по клиенту на обращение', async () => {
    const { prisma } = await import('../prisma');

    // Первое обращение создаёт клиента и обязано его закэшировать.
    void prisma.$transaction;
    const first = (globalThis as { prisma?: unknown }).prisma;
    expect(first).toBeDefined();

    // Последующие обращения обязаны отдавать того же самого.
    void prisma.$connect;
    void prisma.internalChange;
    expect((globalThis as { prisma?: unknown }).prisma).toBe(first);
  });

  it('отдаёт методы, привязанные к клиенту, а не к прокси', async () => {
    const { prisma } = await import('../prisma');

    // Без bind метод вызывался бы с `this` === прокси, и каждое обращение
    // движка к собственным полям снова шло бы через ловушку get.
    const fn = prisma.$transaction as unknown as { name: string };
    expect(typeof fn).toBe('function');
    expect(fn.name).toBe('bound $transaction');
  });
});
