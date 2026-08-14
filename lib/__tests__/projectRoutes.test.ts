import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET as listProjects, POST as createProject } from '@/app/api/projects/route';
import {
  GET as getProject,
  PUT as updateProject,
  DELETE as deleteProject,
} from '@/app/api/projects/[id]/route';
import { POST as createVersion } from '@/app/api/calculations/[id]/version/route';

vi.mock('@/lib/access', () => ({
  requireStaff: vi.fn(),
  requireCalcAccess: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
  clientIp: vi.fn(() => '127.0.0.1'),
  actorTypeFromAccess: vi.fn(() => 'user'),
}));

vi.mock('@/lib/project', () => ({
  getOrCreateProject: vi.fn(),
  getProjectDetails: vi.fn(),
  createCalculationVersion: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    calculation: {
      findUnique: vi.fn(),
    },
  },
}));

import { requireStaff, requireCalcAccess } from '@/lib/access';
import { getOrCreateProject, getProjectDetails, createCalculationVersion } from '@/lib/project';
import { prisma } from '@/lib/prisma';

describe('Project API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/projects', () => {
    it('returns paginated list of projects for staff', async () => {
      vi.mocked(requireStaff).mockResolvedValue({
        userId: 'u1',
        username: 'arch',
        role: 'architect',
        exp: Date.now() + 10000,
      });

      vi.mocked(prisma.project.count).mockResolvedValue(1);
      vi.mocked(prisma.project.findMany).mockResolvedValue([
        {
          id: 'p1',
          name: 'Банк Проект',
          customer: 'Банк',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      ]);

      const req = new NextRequest('http://localhost:3000/api/projects?page=1&limit=20');
      const res = await listProjects(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveLength(1);
      expect(json[0].name).toBe('Банк Проект');
      expect(res.headers.get('X-Total-Count')).toBe('1');
    });

    it('denies unauthenticated request', async () => {
      vi.mocked(requireStaff).mockResolvedValue(
        NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
      );

      const req = new NextRequest('http://localhost:3000/api/projects');
      const res = await listProjects(req);

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/projects', () => {
    it('creates project if staff and valid body', async () => {
      vi.mocked(requireStaff).mockResolvedValue({
        userId: 'u1',
        username: 'arch',
        role: 'architect',
        exp: Date.now() + 10000,
      });

      vi.mocked(getOrCreateProject).mockResolvedValue({
        id: 'p_new',
        name: 'Новый проект',
        customer: 'Клиент',
      } as any);

      const req = new NextRequest('http://localhost:3000/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: 'Новый проект', customer: 'Клиент' }),
      });

      const res = await createProject(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.id).toBe('p_new');
    });

    it('validates required fields', async () => {
      vi.mocked(requireStaff).mockResolvedValue({
        userId: 'u1',
        username: 'arch',
        role: 'architect',
        exp: Date.now() + 10000,
      });

      const req = new NextRequest('http://localhost:3000/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: '' }),
      });

      const res = await createProject(req);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/projects/[id]', () => {
    it('returns project details', async () => {
      vi.mocked(requireStaff).mockResolvedValue({
        userId: 'u1',
        username: 'arch',
        role: 'architect',
        exp: Date.now() + 10000,
      });

      vi.mocked(getProjectDetails).mockResolvedValue({
        id: 'p1',
        name: 'Проект 1',
        calculations: [],
      } as any);

      const req = new NextRequest('http://localhost:3000/api/projects/p1');
      const res = await getProject(req, { params: Promise.resolve({ id: 'p1' }) });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.id).toBe('p1');
    });
  });

  describe('POST /api/calculations/[id]/version', () => {
    it('creates a new version for an authorized calculation', async () => {
      vi.mocked(requireCalcAccess).mockResolvedValue({
        kind: 'staff',
        session: { userId: 'u1', username: 'arch', role: 'architect', exp: 123 },
        actorId: 'u1',
      });

      vi.mocked(createCalculationVersion).mockResolvedValue({
        id: 'calc_v2',
        version: 2,
        projectId: 'p1',
        name: 'Расчет v2',
        status: 'draft',
      } as any);

      const req = new NextRequest('http://localhost:3000/api/calculations/calc_1/version', {
        method: 'POST',
        body: JSON.stringify({ versionComment: 'Обновлена смета' }),
      });

      const res = await createVersion(req, { params: Promise.resolve({ id: 'calc_1' }) });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.id).toBe('calc_v2');
      expect(json.version).toBe(2);
    });
  });
});
