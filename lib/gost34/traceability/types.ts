export type TraceMethod = 'MANUAL' | 'RULE' | 'LLM';

export interface TraceLink {
  sourceId: string; // ID of Gost34RequirementV2
  targetId: string; // ID of Gost34StageItem
  method: TraceMethod;
  confidence?: number;
  approved: boolean;
}

export interface TraceabilityMetrics {
  totalRequirements: number;
  mappedRequirements: number;
  unmappedRequirements: number;
  coveragePercentage: number;
}

export interface TraceabilityResult {
  links: TraceLink[];
  metrics: TraceabilityMetrics;
}
