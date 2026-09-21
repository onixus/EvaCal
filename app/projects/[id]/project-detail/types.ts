import type { DealProjectView } from '@/components/DealPanel';

export interface SerializedStage {
  id: string;
  name: string;
  role: string;
  hours: number;
  isApprovalTask: boolean;
  order: number;
}

export interface SerializedRisk {
  id: string;
  description: string;
  hours: number;
  order: number;
}

export interface SerializedCalculation {
  id: string;
  name: string;
  customer: string;
  version: number;
  status: string;
  versionComment: string | null;
  startDate: string;
  pmHours: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  template: { id: string; name: string };
  stages: SerializedStage[];
  risks: SerializedRisk[];
  currency: string;
  roleRates: string | null;
  overheadPercent: number;
  marginPercent: number;
  discountPercent: number;
  vatPercent: number;
  includeVat: boolean;
  standardProfileId: string | null;
  standardProfileVersion: string | null;
  generatorVersion: string | null;
}

export interface SerializedGostPackage {
  id: string;
  name: string;
  version: number;
  status: string;
  calculationId: string;
  calculation?: { id: string; name: string; version: number; status: string } | null;
  standardProfileId: string;
  standardProfileVersion: string;
  generatorVersion: string;
  documentTypes: string;
  metadata: string | null;
  artifactPath?: string | null;
  hasArtifact?: boolean;
  checksum: string | null;
  releasedAt?: string | null;
  releasedBy?: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  reviewStage?: string | null;
  reviewComment?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedProject {
  id: string;
  name: string;
  customer: string;
  code: string | null;
  description: string | null;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  calculations: SerializedCalculation[];
  packages: SerializedGostPackage[];
  deal: DealProjectView;
}
