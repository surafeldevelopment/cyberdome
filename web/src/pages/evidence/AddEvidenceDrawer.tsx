import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { Drawer, useToast } from '../../components/overlay';
import { FileDrop } from '../../components/evidence';
import { Field, Notice, Tabs } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { fmtBytes, fromLocalInput } from '../../lib/format';
import { emptyMeta, MetadataFields, useStatus, type MetaState } from './shared';

type Mode = 'file' | 'text' | 'reference';

export function AddEvidenceDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { base, isDemo } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const status = useStatus();
  const maxMb = status.data?.maxUploadMb ?? 50;

  const [mode, setMode] = useState<Mode>('file');
  const [m, setM] = useState<MetaState>(emptyMeta(isDemo));
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('');
  const [uri, setUri] = useState('');
  const [refHash, setRefHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; code: string; duplicate_of?: string | null; sha256?: string | null } | null>(null);

  const reset = () => {
    setM(emptyMeta(isDemo));
    setFile(null);
    setText('');
    setFilename('');
    setUri('');
    setRefHash('');
    setErr(null);
    setResult(null);
  };
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isDemo]);

  const set = (p: Partial<MetaState>) => setM((x) => ({ ...x, ...p }));
  const tooBig = file && file.size > maxMb * 1024 * 1024;
  const hashOk = !refHash.trim() || /^[a-f0-9]{64}$/i.test(refHash.trim());
  const canSubmit = !busy && (mode === 'file' ? !!file && !tooBig : mode === 'text' ? !!text.trim() : !!uri.trim() && hashOk);

  const common = () => ({
    title: m.title.trim() || undefined,
    source_category: isDemo ? 'demo' : m.source_category,
    source_tool: m.source_tool,
    collected_at: fromLocalInput(m.collected_at),
    collected_at_note: m.collected_at_note,
    observation: m.observation,
    interpretation: m.interpretation,
    confidence: m.confidence,
    tags: m.tags,
    sanitization_status: m.sanitization_status,
    asset_ids: m.asset_ids,
  });

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      let r: any;
      if (mode === 'file' && file) {
        const f = new FormData();
        f.append('file', file);
        for (const [k, v] of Object.entries(common())) {
          if (v === undefined || v === null || v === '') continue;
          if (Array.isArray(v)) {
            if (v.length) f.append(k, v.join(','));
          } else f.append(k, String(v));
        }
        r = await api.upload(`${base}/evidence`, f);
      } else if (mode === 'text') {
        r = await api.post(`${base}/evidence/text`, { ...common(), text, filename: filename.trim() || undefined });
      } else {
        r = await api.post(`${base}/evidence/reference`, { ...common(), reference_uri: uri.trim(), reference_sha256: refHash.trim() || undefined });
      }
      setResult({ id: r.id, code: r.code, duplicate_of: r.duplicate_of, sha256: r.sha256 });
      qc.invalidateQueries({ queryKey: ['evidence'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`Saved ${r.code}.`);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add evidence"
      subtitle="Every item gets a permanent Evidence ID. Files are hashed (SHA-256) from their actual bytes and stored unchanged."
      footer={
        result ? (
          <>
            <button className="btn ghost" onClick={reset}>Add another</button>
            <Link className="btn primary" to={`/evidence/${result.id}`} onClick={onClose}>Open {result.code}</Link>
          </>
        ) : (
          <>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!canSubmit} onClick={submit}>
              {busy ? <span className="spinner" /> : <Save />} Save evidence
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="stack">
          <Notice tone="ok" title={`Saved as ${result.code}.`}>
            {result.sha256 ? <>SHA-256 <span className="mono ev-hash-inline">{result.sha256}</span></> : 'Recorded as a reference; no file is stored here.'}
          </Notice>
          {result.duplicate_of && (
            <Notice tone="warn" title="Possible duplicate.">
              This file has the same SHA-256 as {result.duplicate_of}. Both records are kept; withdraw one if it was uploaded by mistake.
            </Notice>
          )}
        </div>
      ) : (
        <div className="stack">
          <Tabs
            label="Evidence type"
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            tabs={[
              { id: 'file', label: 'Upload file' },
              { id: 'text', label: 'Paste text output' },
              { id: 'reference', label: 'Reference' },
            ]}
          />
          {isDemo && <Notice tone="info">You are in the demo engagement, so this item will be labeled as demo data.</Notice>}
          {mode === 'file' && (
            <>
              <FileDrop
                file={file}
                onFile={setFile}
                hint={`Screenshots, sanitized output, logs, CSV/JSON/XML, PDF, PCAP/PCAPNG · up to ${maxMb} MB · executables are refused`}
              />
              {tooBig && <Notice tone="bad">This file is {fmtBytes(file!.size)}, above the {maxMb} MB limit. Record it as a reference instead.</Notice>}
              <p className="small faint">
                The type is detected from the file bytes, not the extension. HTML, SVG, and scripts are stored but never rendered.
              </p>
            </>
          )}
          {mode === 'text' && (
            <div className="form-grid">
              <Field label="Sanitized output" full htmlFor="ev-text" help="Paste command or tool output after removing passwords, keys, tokens, and unrelated personal data.">
                <textarea id="ev-text" className="mono-input" style={{ minHeight: 180 }} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
              </Field>
              <Field label="File name" htmlFor="ev-fname" help="Optional; defaults to the title.">
                <input id="ev-fname" type="text" className="mono-input" placeholder="nmap-sV-output.txt" value={filename} onChange={(e) => setFilename(e.target.value)} />
              </Field>
            </div>
          )}
          {mode === 'reference' && (
            <div className="form-grid">
              <Field label="Location (URI or path)" full htmlFor="ev-uri" help="Where the artifact is kept, e.g. a PCAP on the lab share or a PDF report. The file itself is not stored here.">
                <input id="ev-uri" type="text" className="mono-input" value={uri} onChange={(e) => setUri(e.target.value)} placeholder="\\lab-share\\week9\\capture.pcapng" />
              </Field>
              <Field
                label="SHA-256 (analyst-supplied, not calculated)"
                full
                htmlFor="ev-refhash"
                error={hashOk ? undefined : 'Must be 64 hexadecimal characters.'}
                help="Optional. Shown as analyst-supplied because this application cannot read the referenced file."
              >
                <input id="ev-refhash" type="text" className="mono-input" value={refHash} onChange={(e) => setRefHash(e.target.value)} spellCheck={false} />
              </Field>
            </div>
          )}
          <div className="divider" />
          <MetadataFields m={m} set={set} isDemo={isDemo} />
          {err && <Notice tone="bad" title="Not saved.">{err}</Notice>}
        </div>
      )}
    </Drawer>
  );
}
