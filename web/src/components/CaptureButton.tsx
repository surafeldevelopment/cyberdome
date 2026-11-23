import { useState } from 'react';
import { Camera } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toPng } from 'html-to-image';
import { api, errorMessage } from '../lib/api';
import { useEngagement } from '../lib/engagement';
import { useToast } from './overlay';

/**
 * Captures the current CyberDome view (the #main-content element) as a PNG and stores it in
 * the Evidence Locker as a "project artifact". It only ever captures this application's own
 * screen — it cannot and does not fabricate screenshots of external tool activity.
 * If `requirementId` is given, the capture is attached to that screenshot requirement.
 */
export function CaptureButton({ label = 'Capture view', title, requirementId, compact }: { label?: string; title: string; requirementId?: string; compact?: boolean }) {
  const { base, isDemo } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const capture = async () => {
    const node = document.getElementById('main-content');
    if (!node) return;
    setBusy(true);
    try {
      const dataUrl = await toPng(node, {
        backgroundColor: '#090a09',
        pixelRatio: Math.min(2, window.devicePixelRatio || 1),
        filter: (el) => !(el instanceof HTMLElement && el.dataset?.noCapture === 'true'),
      });
      const blob = await (await fetch(dataUrl)).blob();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const form = new FormData();
      form.append('file', new File([blob], `capture-${stamp}.png`, { type: 'image/png' }));
      form.append('title', `Screenshot: ${title}`);
      form.append('source_category', isDemo ? 'demo' : 'project_artifact');
      form.append('source_tool', 'CyberDome view capture');
      form.append('collected_at', new Date().toISOString());
      form.append('observation', `Capture of the CyberDome “${title}” view as displayed at ${new Date().toLocaleString()}.`);
      form.append('sanitization_status', 'not_reviewed');
      form.append('tags', 'screenshot,app-capture');
      const ev = await api.upload<{ id: string; code: string }>(`${base}/evidence`, form);
      if (requirementId) await api.put(`${base}/tracker/screenshots/${requirementId}`, { evidence_id: ev.id });
      qc.invalidateQueries();
      toast.success(`Saved ${ev.code}${requirementId ? ' and attached it to the requirement' : ''}. Review it for sensitive data before submitting.`);
    } catch (e) {
      toast.error(`Capture failed: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className={`btn ${compact ? 'sm' : ''}`} onClick={capture} disabled={busy} data-no-capture="true" title="Save a PNG of this view to the Evidence Locker">
      {busy ? <span className="spinner" /> : <Camera />}
      {label}
    </button>
  );
}
