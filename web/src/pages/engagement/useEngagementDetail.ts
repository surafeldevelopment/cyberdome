import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { useToast } from '../../components/overlay';
import type { Engagement } from '../../lib/types';

export function useEngagementDetail() {
  const { eid } = useEngagement();
  return useQuery({ queryKey: ['engagement', eid], queryFn: () => api.get<Engagement>(`/api/engagements/${eid}`), enabled: !!eid });
}

/** Mutation that returns the updated engagement and refreshes dependent views. */
export function useEngagementMutation<V>(fn: (v: V) => Promise<Engagement>, success?: string) {
  const { eid } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      qc.setQueryData(['engagement', eid], data);
      qc.invalidateQueries({ queryKey: ['engagements'] });
      qc.invalidateQueries({ queryKey: ['dashboard', eid] });
      qc.invalidateQueries({ queryKey: ['tracker', eid] });
      if (success) toast.success(success);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}
