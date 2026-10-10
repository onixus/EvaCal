import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ source: vi.fn(), list: vi.fn() }));
vi.mock('../prisma', () => ({
  prisma: { catalogImport: { findUnique: mocks.source, findMany: mocks.list } },
}));
import { listImports } from './import-store';
describe('saved GPL history pagination', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.list.mockResolvedValue([]);
  });
  it('uses a deterministic ordering for equally dated files and bounded pages without source bytes', async () => {
    await listImports();
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    );
    expect(mocks.list.mock.calls[0][0].select.file).toBeUndefined();
    expect(mocks.source).not.toHaveBeenCalled();
  });
  it('continues after the selected cursor without including it again', async () => {
    mocks.source.mockResolvedValue({ id: 'last' });
    await listImports('last');
    expect(mocks.source).toHaveBeenCalledWith({ where: { id: 'last' }, select: { id: true } });
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'last' }, skip: 1, take: 100 }),
    );
  });
  it('rejects a missing cursor before fetching a page', async () => {
    mocks.source.mockResolvedValue(null);
    await expect(listImports('missing')).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it.each(['', 'x'.repeat(101)])(
    'rejects an invalid cursor before touching storage',
    async (cursor) => {
      await expect(listImports(cursor)).rejects.toMatchObject({ statusCode: 400 });
      expect(mocks.list).not.toHaveBeenCalled();
      expect(mocks.source).not.toHaveBeenCalled();
    },
  );
});
