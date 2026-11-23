import { useEffect, useMemo, useState } from 'react';
import { Save, Undo2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import type { Engagement } from '../../lib/types';
import { Field, Panel, Badge } from '../../components/ui';
import { toLocalInput, fromLocalInput } from '../../lib/format';
import { useEngagementMutation } from './useEngagementDetail';

// Packet-derived defaults seeded by the server (server/services/bootstrap.ts). Used only to label
// text that still matches the packet wording, so students can see what they have not yet tailored.
const PACKET_HINT = 'From the NWIT 246 project packet';
const PACKET_TEXT: Record<string, string> = {
  purpose:
    'CyberDome Corporation recently expanded its network and web services and is concerned that new systems may have unnecessary services, weak configurations, or outdated software. Assess the instructor-approved lab environment: identify the exposed attack surface, document weaknesses, interpret evidence, and produce a professional security assessment.',
  rules_of_engagement: [
    'Use only systems, networks, files, and targets specifically authorized by the instructor.',
    'Do not scan public Internet targets, other students, college production systems, or any third-party system without written authorization.',
    'If a tool or action is not clearly within scope, stop and ask the instructor before proceeding.',
    'All AI-generated findings must be verified against the actual evidence before being included in the final report.',
    'Do not enter real passwords, API keys, private student data, or sensitive institutional information into public AI tools.',
  ].join('\n'),
  prohibited_actions: [
    'Denial-of-service testing',
    'Destructive testing',
    'Persistence',
    'Credential theft',
    'Data exfiltration against real systems',
    'Scanning public Internet targets, other students, or college production systems',
  ].join('\n'),
  approved_evidence_sources:
    'Instructor-approved Windows CMD or Kali Linux evidence; instructor-approved scanners against assigned lab targets; instructor-provided PCAP, log, and host evidence packages; instructor-provided scan reports.',
};

const TZ_SUGGEST = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC', 'Africa/Addis_Ababa', 'Europe/London'];

type Form = {
  client_name: string;
  purpose: string;
  authorization_ref: string;
  window_start: string;
  window_end: string;
  timezone: string;
  rules_of_engagement: string;
  prohibited_actions: string;
  approved_evidence_sources: string;
  status: string;
};

const toForm = (e: Engagement): Form => ({
  client_name: e.client_name,
  purpose: e.purpose,
  authorization_ref: e.authorization_ref,
  window_start: toLocalInput(e.window_start),
  window_end: toLocalInput(e.window_end),
  timezone: e.timezone,
  rules_of_engagement: e.rules_of_engagement,
  prohibited_actions: e.prohibited_actions,
  approved_evidence_sources: e.approved_evidence_sources,
  status: e.status,
});

export function OverviewTab({ eng }: { eng: Engagement }) {
  const { eid } = useEngagement();
  const [form, setForm] = useState<Form>(() => toForm(eng));
  useEffect(() => setForm(toForm(eng)), [eng]);

  const original = useMemo(() => toForm(eng), [eng]);
  const dirty = (Object.keys(form) as (keyof Form)[]).filter((k) => form[k] !== original[k]);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useEngagementMutation(() => {
    const body: Record<string, any> = {};
    for (const k of dirty) {
      if (k === 'window_start' || k === 'window_end') body[k] = fromLocalInput(form[k]);
      else body[k] = form[k];
    }
    return api.patch<Engagement>(`/api/engagements/${eid}`, body);
  }, 'Engagement saved.');
  const prefilled = (k: 'rules_of_engagement' | 'prohibited_actions' | 'approved_evidence_sources' | 'purpose') =>
    !!form[k] && form[k].trim() === PACKET_TEXT[k];

  return (
    <div className="stack">
      <Panel title="Engagement details" hint={dirty.length ? `${dirty.length} unsaved change${dirty.length === 1 ? '' : 's'}` : undefined}>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty.length) save.mutate(undefined);
          }}
        >
          <Field label="Client name" htmlFor="f-client">
            <input id="f-client" value={form.client_name} onChange={set('client_name')} maxLength={200} />
          </Field>
          <Field label="Assessment status" htmlFor="f-status">
            <select id="f-status" value={form.status} onChange={set('status')}>
              <option value="planning">Planning</option>
              <option value="active">Active testing</option>
              <option value="reporting">Reporting</option>
              <option value="complete">Complete</option>
              <option value="on_hold">On hold</option>
            </select>
          </Field>
          <Field label={<>Assessment purpose {prefilled('purpose') && <Badge tone="muted">{PACKET_HINT}</Badge>}</>} full htmlFor="f-purpose">
            <textarea id="f-purpose" value={form.purpose} onChange={set('purpose')} rows={3} />
          </Field>
          <Field label="Written authorization reference" htmlFor="f-auth" full help="Where your written authorization comes from, for example the instructor's assignment or approval email.">
            <input id="f-auth" className="mono-input" value={form.authorization_ref} onChange={set('authorization_ref')} placeholder="e.g. NWIT246-F26-AUTH-<your team>" maxLength={500} />
          </Field>
          <Field label="Testing window start" htmlFor="f-ws" help="Optional. Recorded in the report.">
            <input id="f-ws" type="datetime-local" value={form.window_start} onChange={set('window_start')} />
          </Field>
          <Field label="Testing window end" htmlFor="f-we">
            <input id="f-we" type="datetime-local" value={form.window_end} onChange={set('window_end')} />
          </Field>
          <Field label="Engagement timezone (IANA)" htmlFor="f-tz" help="Used to interpret log timestamps that lack an offset. Validated by the server.">
            <input id="f-tz" className="mono-input" list="tz-list" value={form.timezone} onChange={set('timezone')} />
            <datalist id="tz-list">{TZ_SUGGEST.map((t) => <option key={t} value={t} />)}</datalist>
          </Field>
          <div />
          <Field label={<>Rules of engagement {prefilled('rules_of_engagement') && <Badge tone="muted">{PACKET_HINT}</Badge>}</>} full htmlFor="f-roe">
            <textarea id="f-roe" value={form.rules_of_engagement} onChange={set('rules_of_engagement')} rows={5} />
          </Field>
          <Field label={<>Prohibited actions {prefilled('prohibited_actions') && <Badge tone="muted">{PACKET_HINT}</Badge>}</>} htmlFor="f-pro">
            <textarea id="f-pro" value={form.prohibited_actions} onChange={set('prohibited_actions')} rows={6} />
          </Field>
          <Field label={<>Approved evidence sources {prefilled('approved_evidence_sources') && <Badge tone="muted">{PACKET_HINT}</Badge>}</>} htmlFor="f-src">
            <textarea id="f-src" value={form.approved_evidence_sources} onChange={set('approved_evidence_sources')} rows={6} />
          </Field>
          <div className="full row" style={{ justifyContent: 'flex-end' }}>
            {dirty.length > 0 && (
              <button type="button" className="btn ghost" onClick={() => setForm(original)}>
                <Undo2 /> Discard changes
              </button>
            )}
            <button type="submit" className="btn primary" disabled={!dirty.length || save.isPending}>
              {save.isPending ? <span className="spinner" /> : <Save />} Save engagement
            </button>
          </div>
        </form>
      </Panel>

    </div>
  );
}
