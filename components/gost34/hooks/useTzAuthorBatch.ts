'use client';

import { useState, useRef, useCallback } from 'react';
import type { TzAuthorState, TzSectionProposal } from '@/lib/gost34/llm/tzAuthor/types';
import { TZ_AUTHOR_PROMPT_VERSION } from '@/lib/gost34/llm/tzAuthor/types';
import { withShareHeaders } from '@/lib/shareClient';

export interface BatchNodeTarget {
  id: string;
  title: string;
}

export interface FailedNodeItem {
  id: string;
  title: string;
  error: string;
}

export interface UseTzAuthorBatchOptions {
  calculationId: string;
  providerId?: string;
  model?: string;
  rawRequirements?: any[];
  applicabilityOverrides?: any;
  manualLinks?: any[];
  standardProfileId?: string;
  tzAuthor?: TzAuthorState;
  onUpdateTzAuthor?: (tzAuthor: TzAuthorState) => void;
}

export function useTzAuthorBatch({
  calculationId,
  providerId,
  model,
  rawRequirements,
  applicabilityOverrides,
  manualLinks,
  standardProfileId,
  tzAuthor,
  onUpdateTzAuthor,
}: UseTzAuthorBatchOptions) {
  const [isRunning, setIsRunning] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [currentNode, setCurrentNode] = useState<BatchNodeTarget | null>(null);
  const [failedNodes, setFailedNodes] = useState<FailedNodeItem[]>([]);
  const [completedNodeIds, setCompletedNodeIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const latestTzAuthorRef = useRef<TzAuthorState | undefined>(tzAuthor);
  latestTzAuthorRef.current = tzAuthor;

  const cancelBatch = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsRunning(false);
    setIsCancelled(true);
  }, []);

  const resetBatch = useCallback(() => {
    cancelBatch();
    setIsRunning(false);
    setIsCancelled(false);
    setCurrentIndex(0);
    setTotalCount(0);
    setCurrentNode(null);
    setFailedNodes([]);
    setCompletedNodeIds([]);
    setError(null);
  }, [cancelBatch]);

  const runSequence = useCallback(
    async (
      targetNodes: BatchNodeTarget[],
      options?: { speculate?: boolean },
    ) => {
      if (targetNodes.length === 0) return;

      setIsRunning(true);
      setIsCancelled(false);
      setError(null);
      setTotalCount(targetNodes.length);
      setCurrentIndex(0);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const newlyFailed: FailedNodeItem[] = [];
      let currentState: TzAuthorState = latestTzAuthorRef.current || {
        promptVersion: TZ_AUTHOR_PROMPT_VERSION,
        speculateDefault: false,
        proposals: {},
      };

      for (let i = 0; i < targetNodes.length; i++) {
        if (controller.signal.aborted) {
          setIsCancelled(true);
          break;
        }

        const node = targetNodes[i];
        setCurrentIndex(i + 1);
        setCurrentNode(node);

        try {
          const res = await fetch('/api/gost34/draft-tz', {
            method: 'POST',
            headers: withShareHeaders(calculationId, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              calculationId,
              nodeId: node.id,
              providerId,
              model,
              speculate: Boolean(options?.speculate),
              rawRequirements,
              applicabilityOverrides,
              manualLinks,
              standardProfileId,
            }),
            signal: controller.signal,
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP ${res.status}`);
          }

          const data = await res.json();
          if (data.proposal) {
            currentState = {
              promptVersion: currentState.promptVersion || TZ_AUTHOR_PROMPT_VERSION,
              speculateDefault: false,
              proposals: {
                ...currentState.proposals,
                [node.id]: data.proposal as TzSectionProposal,
              },
            };
            latestTzAuthorRef.current = currentState;
            onUpdateTzAuthor?.(currentState);
            setCompletedNodeIds((prev) => (prev.includes(node.id) ? prev : [...prev, node.id]));
          }
        } catch (err: unknown) {
          if (controller.signal.aborted) {
            setIsCancelled(true);
            break;
          }
          const errMsg = err instanceof Error ? err.message : 'Ошибка при формировании черновика';
          newlyFailed.push({ id: node.id, title: node.title, error: errMsg });
          setFailedNodes([...newlyFailed]);
        }
      }

      setIsRunning(false);
      setCurrentNode(null);
      abortControllerRef.current = null;

      if (newlyFailed.length > 0) {
        setError(`Ошибок при генерации: ${newlyFailed.length} из ${targetNodes.length}`);
      }
    },
    [
      calculationId,
      providerId,
      model,
      rawRequirements,
      applicabilityOverrides,
      manualLinks,
      standardProfileId,
      onUpdateTzAuthor,
    ],
  );

  const startBatch = useCallback(
    async (
      allNodes: BatchNodeTarget[],
      options?: { speculate?: boolean; onlyUnproposed?: boolean },
    ) => {
      setFailedNodes([]);
      setCompletedNodeIds([]);

      let targetNodes = allNodes;
      if (options?.onlyUnproposed) {
        const currentProposals = latestTzAuthorRef.current?.proposals || {};
        targetNodes = allNodes.filter(
          (n) =>
            !currentProposals[n.id] ||
            currentProposals[n.id].status === 'REJECTED',
        );
      }

      await runSequence(targetNodes, options);
    },
    [runSequence],
  );

  const retryFailed = useCallback(
    async (options?: { speculate?: boolean }) => {
      if (failedNodes.length === 0) return;
      const nodesToRetry = failedNodes.map((f) => ({ id: f.id, title: f.title }));
      setFailedNodes([]);
      await runSequence(nodesToRetry, options);
    },
    [failedNodes, runSequence],
  );

  return {
    isRunning,
    isCancelled,
    currentIndex,
    totalCount,
    currentNode,
    failedNodes,
    completedNodeIds,
    error,
    startBatch,
    cancelBatch,
    retryFailed,
    resetBatch,
  };
}
