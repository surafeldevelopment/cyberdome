import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, Flag, ShieldQuestion, ListOrdered } from 'lucide-react';
import { api } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { PageHeader, Tabs, useTab } from '../../components/ui';
import { CaptureButton } from '../../components/CaptureButton';
import { KpiCard, KpiRow } from '../../components/kit';
import { EventsTab } from './Events';
import { TimelineTab } from './Timeline';
import { ImportsTab } from './Imports';
import { MappingsTab } from './Mappings';
import { IndicatorsPanel } from './Indicators';
import type { Indicator, TimelineEvent } from './shared';
import '../../styles/attack.css';

const UNRESOLVED = ['unassessed', 'suspicious', 'requires_more_evidence'];

export default function AttackPage() {
  const { base, eid } = useEngagement();
  const nav = useNavigate();
  const [tab, setTab] = useTab('events');
  const [importFilter, setImportFilter] = useState<string | undefined>();
  const timeline = useQuery({ queryKey: ['timeline', eid], queryFn: () => api.get<TimelineEvent[]>(`${base}/timeline`), enabled: !!eid });
  const indicators = useQuery({ queryKey: ['indicators', eid, 'lab5'], queryFn: () => api.get<Indicator[]>(`${base}/indicators?lab=lab5`), enabled: !!eid });
  const imports = useQuery({ queryKey: ['log-imports', eid], queryFn: () => api.get<any[]>(`${base}/log-imports`), enabled: !!eid });
  const mappings = useQuery({ queryKey: ['attack-mappings', eid], queryFn: () => api.get<any[]>(`${base}/attack-mappings`), enabled: !!eid });
  const allEv = useQuery({ queryKey: ['log-events', eid, 'kpi-all'], queryFn: () => api.get<{ total: number; facets: any }>(`${base}/log-events?limit=1`), enabled: !!eid });
  const flagged = useQuery({ queryKey: ['log-events', eid, 'kpi-flagged'], queryFn: () => api.get<{ total: number }>(`${base}/log-events?flagged=1&limit=1`), enabled: !!eid });

  const total = allEv.data?.total;
  const tsFacet: { v: string; n: number }[] = allEv.data?.facets?.ts_status ?? [];
  const unplacedEvents = tsFacet.filter((x) => x.v === 'missing' || x.v === 'unparseable').reduce((a, x) => a + x.n, 0);
  const ind = indicators.data ?? [];
  const unresolved = ind.filter((i) => UNRESOLVED.includes(i.assessment)).length;
  const tl = timeline.data ?? [];
  const tlUnplaced = tl.filter((t) => !t.normalized_ts).length;
  const tlInterpreted = tl.filter((t) => t.student_interpretation.trim()).length;

  return (
    <>
      <PageHeader
        title="Attack Evidence"
        subtitle="Lab 5: analyze the supplied PCAP, log and host evidence, record meaningful indicators, and reconstruct a defensible timeline. Facts and assumptions are labeled separately; uncertain items are marked “requires additional evidence”."
      />
      <KpiRow>
        <KpiCard
          icon={<Activity />}
          label="Log events imported"
          value={total ?? '—'}
          pill={total !== undefined ? { text: `${unplacedEvents} unplaced`, tone: unplacedEvents ? 'warn' : 'neutral' } : null}
          onClick={() => nav('/attack')}
          calc="Imported log and packet-summary rows across all log imports. Pill: rows whose timestamp is missing or could not be placed on the clock (never guessed)."
        />
        <KpiCard
          icon={<Flag />}
          label="Flagged events"
          value={flagged.data?.total ?? '—'}
          pill={total !== undefined ? { text: `of ${total}`, tone: 'neutral' } : null}
          onClick={() => nav('/attack?tab=events&flagged=1')}
          calc="Events an analyst flagged as meaningful on the Events tab."
        />
        <KpiCard
          icon={<ShieldQuestion />}
          label="Unresolved indicators"
          value={indicators.data ? unresolved : '—'}
          pill={indicators.data ? { text: `of ${ind.length}`, tone: unresolved ? 'bad' : 'ok' } : null}
          onClick={() => nav('/attack?tab=indicators&unresolved=1')}
          calc="Lab 5 indicators assessed as suspicious, requiring additional evidence, or not yet assessed."
        />
        <KpiCard
          icon={<ListOrdered />}
          label="Timeline events"
          value={timeline.data ? tl.length : '—'}
          pill={timeline.data ? (tlUnplaced ? { text: `${tlUnplaced} unplaced`, tone: 'warn' } : { text: `${tlInterpreted} interpreted`, tone: tlInterpreted >= 5 ? 'ok' : 'neutral' }) : null}
          onClick={() => nav('/attack?tab=timeline')}
          calc="Events on the attack timeline. Unplaced = no time could be established from the evidence; these are listed separately, never positioned by guess."
        />
      </KpiRow>
      <Tabs
        label="Attack evidence sections"
        value={tab}
        onChange={(t) => { setTab(t); if (t !== 'events') setImportFilter(undefined); }}
        tabs={[
          { id: 'events', label: 'Events' },
          { id: 'indicators', label: 'Indicators', count: indicators.data?.length },
          { id: 'timeline', label: 'Timeline', count: timeline.data?.length },
          { id: 'imports', label: 'Imports & PCAP', count: imports.data?.length },
          { id: 'mappings', label: 'ATT&CK', count: mappings.data?.length },
        ]}
      />
      {tab === 'events' && <EventsTab importFilter={importFilter} onGoImports={() => setTab('imports')} />}
      {tab === 'indicators' && (
        <div className="stack">
          <div className="row" style={{ justifyContent: 'flex-end' }}><CaptureButton title="Evidence table" compact /></div>
          <IndicatorsPanel lab="lab5" />
        </div>
      )}
      {tab === 'timeline' && <TimelineTab onGoEvents={() => setTab('events')} />}
      {tab === 'imports' && <ImportsTab onViewEvents={(id) => { setImportFilter(id); setTab('events'); }} />}
      {tab === 'mappings' && <MappingsTab />}
    </>
  );
}
