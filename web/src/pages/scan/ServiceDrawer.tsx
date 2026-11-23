import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Drawer, useToast } from '../../components/overlay';
import { Field, KV, Loading, Notice, Provenance } from '../../components/ui';
import { EvidenceChips } from '../../components/evidence';
import { api, errorMessage } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { fmtDateTime } from '../../lib/format';
import { PortState, VersionBadge, svcLabel, type Observation, type Service } from './shared';

/** Edit analyst fields for one service and view its observation history. */
export function ServiceDrawer({ service, onClose }: { service: Service | null; onClose: () => void }) {
  const { base, eid } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');
  const [flag, setFlag] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!service) return;
    setPurpose(service.normal_purpose);
    setNotes(service.analyst_notes);
    setFlag(!!service.needs_investigation);
    setReason(service.investigation_reason);
    setErr('');
  }, [service]);

  const hist = useQuery({
    queryKey: ['service-history', eid, service?.id],
    queryFn: () => api.get<Observation[]>(`${base}/services/${service!.id}/history`),
    enabled: !!service,
  });

  const save = async () => {
    if (!service) return;
    if (flag && !reason.trim()) {
      setErr('Explain why this service needs further investigation.');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`${base}/services/${service.id}`, { normal_purpose: purpose, analyst_notes: notes, needs_investigation: flag, investigation_reason: reason });
      qc.invalidateQueries();
      toast.success(`Saved analyst notes for ${service.asset_code} ${service.port}/${service.protocol}.`);
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={!!service}
      onClose={onClose}
      title={service ? <span><span className="mono">{service.ip ?? service.hostname}</span> · <span className="mono">{service.port}/{service.protocol}</span></span> : ''}
      subtitle={service ? <span>{service.asset_code} · {service.service_name ?? 'unknown service'}</span> : undefined}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving}>{saving && <span className="spinner" />} Save notes</button>
        </>
      }
    >
      {service && (
        <div className="stack">
          <KV
            items={[
              ['State', <PortState state={service.state} />],
              ['Service', <span className="mono">{service.service_name ?? '—'}</span>],
              ['Product / version', <span className="row" style={{ gap: 8 }}><span className="mono">{svcLabel(service)}</span><VersionBadge status={service.version_status} /></span>],
              ['Extra info', service.extra_info ? <span className="mono">{service.extra_info}</span> : '—'],
              ['First seen', fmtDateTime(service.first_seen)],
              ['Last seen', fmtDateTime(service.last_seen)],
              ['Observations', `${service.observation_count} across scan imports`],
              ['Asset', <Link to={`/scan/assets/${service.asset_id}`}>{service.asset_code}</Link>],
            ]}
          />
          {service.version_status !== 'detected' && (
            <Notice tone="info">The version is not confirmed by a service probe. Do not treat a version-based CVE match as a confirmed vulnerability.</Notice>
          )}
          <div className="divider" />
          <h3 className="row" style={{ gap: 8 }}>Analyst notes <Provenance kind="entered" /></h3>
          <Field label="Normal purpose of this service" htmlFor="svc-purpose" help="What the service is normally used for (Lab 3: correlate at least five services with their purpose).">
            <textarea id="svc-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. SSH provides encrypted remote administration." />
          </Field>
          <Field label="Analyst risk note" htmlFor="svc-notes">
            <textarea id="svc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Review authentication and version exposure." />
          </Field>
          <label className="check">
            <input type="checkbox" checked={flag} onChange={(e) => setFlag(e.target.checked)} /> Requires further investigation
          </label>
          {flag && (
            <Field label="Why does it need investigation?" htmlFor="svc-reason" error={err && !reason.trim() ? err : undefined}>
              <textarea id="svc-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cleartext protocol exposed; confirm whether it is required." />
            </Field>
          )}
          {err && reason.trim() && <Notice tone="bad">{err}</Notice>}
          <div className="divider" />
          <h3>Observation history</h3>
          {hist.isLoading && <Loading />}
          {hist.data && (
            <ul className="list-plain">
              {hist.data.map((o) => (
                <li key={o.id} className="small">
                  <div className="row" style={{ gap: 8 }}>
                    <span className="mono">{fmtDateTime(o.observed_at ?? o.created_at)}</span>
                    {!o.observed_at && <span className="faint">(import time; no timestamp in file)</span>}
                    <PortState state={o.state} />
                    <Link to={`/scan/imports/${o.scan_import_id}`} className="mono">{o.scan_code}</Link>
                    {o.evidence_id && <EvidenceChips items={[{ id: o.evidence_id, code: o.evidence_code ?? '', status: o.evidence_status ?? 'active' }]} />}
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 4 }}>
                    <span className="mono muted">{o.service_name ?? '—'} {svcLabel(o)}</span>
                    <VersionBadge status={o.version_status} />
                    {o.service_method && <span className="faint">method: {o.service_method}{o.service_conf !== null ? `, conf ${o.service_conf}` : ''}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Drawer>
  );
}
