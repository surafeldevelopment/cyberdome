import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { EngagementSummary } from './types';

interface EngagementCtx {
  engagements: EngagementSummary[];
  current: EngagementSummary | null;
  eid: string;
  /** Base API path for the current engagement, e.g. /api/engagements/<id> */
  base: string;
  isDemo: boolean;
  setEngagement: (id: string) => void;
  loading: boolean;
  error: unknown;
}

const Ctx = createContext<EngagementCtx | null>(null);
const KEY = 'cyberdome.engagement';

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function EngagementProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<string | null>(readStored);
  const q = useQuery({ queryKey: ['engagements'], queryFn: () => api.get<EngagementSummary[]>('/api/engagements'), refetchOnWindowFocus: false });
  const engagements = q.data ?? [];
  const current = engagements.find((e) => e.id === selected) ?? engagements.find((e) => !e.is_demo) ?? engagements[0] ?? null;

  useEffect(() => {
    if (current && current.id !== selected) setSelected(current.id);
  }, [current, selected]);

  const value = useMemo<EngagementCtx>(
    () => ({
      engagements,
      current,
      eid: current?.id ?? '',
      base: current ? `/api/engagements/${current.id}` : '',
      isDemo: !!current?.is_demo,
      setEngagement: (id: string) => {
        setSelected(id);
        try {
          localStorage.setItem(KEY, id);
        } catch {
          /* storage unavailable: selection lasts for this tab only */
        }
      },
      loading: q.isLoading,
      error: q.error,
    }),
    [engagements, current, q.isLoading, q.error],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEngagement() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useEngagement outside provider');
  return c;
}
