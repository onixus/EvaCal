/**
 * Compliance evidence is server data: copies in a client-sent specification and any
 * client «live» state are dropped, so this path prints «Не подтверждено» for them.
 */
export function withoutClientEvidence<T>(calculation: T): T {
  if (!calculation || typeof calculation !== 'object' || Array.isArray(calculation))
    return calculation;
  const { evidenceLive: _live, ...rest } = calculation as Record<string, unknown>;
  void _live;
  const spec = rest.specification as { items?: unknown } | undefined;
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.items)) return rest as T;
  return {
    ...rest,
    specification: {
      ...spec,
      items: spec.items.map((item) => {
        if (!item || typeof item !== 'object') return item;
        const { evidence: _evidence, ...row } = item as Record<string, unknown>;
        void _evidence;
        return row;
      }),
    },
  } as T;
}
