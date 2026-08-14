import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getOrCreateProject,
  createCalculationVersion,
  createGostPackageVersion,
  updateGostPackageStatus,
  getProjectDetails,
  backfillProjects,
} from '@/lib/project';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    calculation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    stage: {
      create: vi.fn(),
    },
    risk: {
      create: vi.fn(),
    },
    gostPackage: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe('lib/project', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getOrCreateProject', () => {
    it('returns existing project if found', async () => {
      const existing = {
        id: 'p1',
        name: 'Банковская АСУ',
        customer: 'Северный Банк',
        status: 'active',
      };
      vi.mocked(prisma.project.findFirst).mockResolvedValue(existing as any);

      const result = await getOrCreateProject({
        name: ' Банковская АСУ ',
        customer: ' Северный Банк ',
      });

      expect(result).toEqual(existing);
      expect(prisma.project.findFirst).toHaveBeenCalledWith({
        where: {
          customer: 'Северный Банк',
          name: 'Банковская АСУ',
        },
        include: {
          calculations: { orderBy: { version: 'desc' } },
          packages: { orderBy: { version: 'desc' } },
        },
      });
      expect(prisma.project.create).not.toHaveBeenCalled();
    });

    it('creates new project if none exists', async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue(null);
      const created = {
        id: 'p2',
        name: 'Новый проект',
        customer: 'ПАО Газ',
        code: 'PRJ-101',
        status: 'active',
        createdBy: 'presale',
      };
      vi.mocked(prisma.project.create).mockResolvedValue(created as any);

      const result = await getOrCreateProject({
        name: 'Новый проект',
        customer: 'ПАО Газ',
        code: 'PRJ-101',
      });

      expect(result).toEqual(created);
      expect(prisma.project.create).toHaveBeenCalledWith({
        data: {
          name: 'Новый проект',
          customer: 'ПАО Газ',
          code: 'PRJ-101',
          description: null,
          status: 'active',
          createdBy: 'presale',
        },
        include: {
          calculations: true,
          packages: true,
        },
      });
    });
  });

  describe('createCalculationVersion', () => {
    it('clones calculation, increments version, and deep-copies stages and risks', async () => {
      const sourceCalc = {
        id: 'calc_1',
        name: 'Оценка внедрения',
        customer: 'Банк',
        templateId: 'tmpl_1',
        answers: '{"users": 100}',
        status: 'approved',
        startDate: new Date('2026-09-01'),
        pmHours: 16,
        createdBy: 'presale',
        projectId: 'proj_1',
        version: 1,
        standardProfileId: 'ru-gost34-current',
        standardProfileVersion: '2020',
        generatorVersion: '0.2.0',
        stages: [
          {
            id: 'st_1',
            name: 'Анализ',
            role: 'analyst',
            hours: 40,
            order: 1,
            startDate: new Date('2026-09-01'),
            endDate: new Date('2026-09-10'),
            isApprovalTask: false,
            approvalForStageId: null,
            status: 'planned',
            dueDate: null,
            requirements: 'ГОСТ 34 ТТ',
            parallel: false,
            approvalDays: 3,
          },
        ],
        risks: [
          {
            id: 'rk_1',
            description: 'Задержка доступов',
            hours: 10,
            order: 1,
          },
        ],
      };

      vi.mocked(prisma.calculation.findUnique)
        .mockResolvedValueOnce(sourceCalc as any) // first call to find source
        .mockResolvedValueOnce({ ...sourceCalc, id: 'calc_2', version: 2 } as any); // return cloned

      vi.mocked(prisma.calculation.findFirst).mockResolvedValue({ version: 1 } as any);
      vi.mocked(prisma.calculation.create).mockResolvedValue({ id: 'calc_2' } as any);

      const result = await createCalculationVersion({
        parentCalculationId: 'calc_1',
        versionComment: 'Версия 2: уточнение сроков',
      });

      expect(prisma.calculation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 'proj_1',
          version: 2,
          parentCalculationId: 'calc_1',
          versionComment: 'Версия 2: уточнение сроков',
          status: 'draft',
        }),
      });

      // Stages deep-copied
      expect(prisma.stage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          calculationId: 'calc_2',
          name: 'Анализ',
          hours: 40,
          role: 'analyst',
        }),
      });

      // Risks deep-copied
      expect(prisma.risk.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          calculationId: 'calc_2',
          description: 'Задержка доступов',
          hours: 10,
        }),
      });

      expect(result).toBeDefined();
    });
  });

  describe('createGostPackageVersion', () => {
    it('creates versioned GOST 34 package and updates calculation stamps', async () => {
      const calc = {
        id: 'calc_1',
        name: 'ТЗ на АСУ',
        customer: 'Заказчик',
        projectId: 'proj_1',
        createdBy: 'architect',
      };
      vi.mocked(prisma.calculation.findUnique).mockResolvedValue(calc as any);
      vi.mocked(prisma.gostPackage.findFirst).mockResolvedValue({ version: 1 } as any);
      vi.mocked(prisma.gostPackage.create).mockResolvedValue({
        id: 'pkg_2',
        projectId: 'proj_1',
        calculationId: 'calc_1',
        version: 2,
        name: 'Комплект ТЗ и ПМИ v2',
        status: 'draft',
      } as any);

      const pkg = await createGostPackageVersion({
        calculationId: 'calc_1',
        name: 'Комплект ТЗ и ПМИ v2',
        standardProfileId: 'ru-gost34-current',
        standardProfileVersion: '2020',
        generatorVersion: '0.2.0',
        documentTypes: ['tz', 'pmi'],
        metadata: { sectionsCount: 8 },
        checksum: 'sha256-mock',
      });

      expect(prisma.gostPackage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 'proj_1',
          calculationId: 'calc_1',
          version: 2,
          standardProfileId: 'ru-gost34-current',
          documentTypes: JSON.stringify(['tz', 'pmi']),
          checksum: 'sha256-mock',
        }),
      });

      expect(prisma.calculation.update).toHaveBeenCalledWith({
        where: { id: 'calc_1' },
        data: expect.objectContaining({
          standardProfileId: 'ru-gost34-current',
          standardProfileVersion: '2020',
        }),
      });

      expect(pkg.id).toBe('pkg_2');
    });
  });

  describe('updateGostPackageStatus', () => {
    it('updates package status to approved with timestamp and approver', async () => {
      vi.mocked(prisma.gostPackage.update).mockResolvedValue({
        id: 'pkg_1',
        status: 'approved',
      } as any);

      await updateGostPackageStatus('pkg_1', 'approved', { approvedBy: 'chief_architect' });

      expect(prisma.gostPackage.update).toHaveBeenCalledWith({
        where: { id: 'pkg_1' },
        data: expect.objectContaining({
          status: 'approved',
          approvedBy: 'chief_architect',
          approvedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('getProjectDetails', () => {
    it('fetches project with ordered calculations and packages', async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'proj_1',
        name: 'АСУ',
        customer: 'Банк',
        calculations: [],
        packages: [],
      } as any);

      const result = await getProjectDetails('proj_1');
      expect(prisma.project.findUnique).toHaveBeenCalledWith({
        where: { id: 'proj_1' },
        include: expect.objectContaining({
          calculations: expect.anything(),
          packages: expect.anything(),
        }),
      });
      expect(result?.id).toBe('proj_1');
    });
  });

  describe('backfillProjects', () => {
    it('migrates orphan calculations and legacy GOST stamps into projects and packages', async () => {
      const orphans = [
        {
          id: 'calc_orphan_1',
          name: 'Проект 1',
          customer: 'Заказчик 1',
          createdBy: 'presale',
          standardProfileId: 'ru-gost34-current',
          standardProfileVersion: '2020',
          generatorVersion: '0.2.0',
          generatedAt: new Date(),
          status: 'approved',
        },
      ];

      vi.mocked(prisma.calculation.findMany).mockResolvedValue(orphans as any);
      vi.mocked(prisma.project.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.project.create).mockResolvedValue({ id: 'proj_new' } as any);
      vi.mocked(prisma.calculation.update).mockResolvedValue({} as any);
      vi.mocked(prisma.gostPackage.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.gostPackage.create).mockResolvedValue({ id: 'pkg_new' } as any);
      vi.mocked(prisma.calculation.findUnique).mockResolvedValue(orphans[0] as any);

      const result = await backfillProjects();
      expect(result.migratedCalculations).toBe(1);
      expect(prisma.project.create).toHaveBeenCalled();
      expect(prisma.calculation.update).toHaveBeenCalled();
    });
  });
});
