import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send } from 'lucide-react';
import { api, errorMessage, PREVIEW } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { Panel, Badge } from '../../components/ui';
import { Markdown } from '../../components/Markdown';

interface Answer {
  id: string;
  code: string;
  question: string;
  response_text: string | null;
  error: string | null;
  model: string;
}

const EXAMPLES = [
  'What is the difference between a vulnerability and an open port?',
  'How should I explain SMB exposure to a non-technical manager?',
  'What makes a good top-three risk rationale?',
];

/** General questions: only the typed question is sent. No evidence, scope or engagement records. */
export function AskPanel({ connected }: { connected: boolean }) {
  const { base, eid } = useEngagement();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [err, setErr] = useState('');

  const ask = useMutation({
    mutationFn: (question: string) => api.post<Answer>(`${base}/ai/sessions`, { task: 'general_question', evidence_ids: [], question }),
    onSuccess: (a) => {
      setAnswers((x) => [a, ...x].slice(0, 5));
      setQ('');
      setErr('');
      qc.invalidateQueries({ queryKey: ['ai-sessions', eid] });
    },
    onError: (e) => setErr(errorMessage(e)),
  });
  const submit = () => q.trim() && !ask.isPending && ask.mutate(q.trim());

  return (
    <Panel
      title={<span className="row" style={{ gap: 8 }}><MessageSquare size={17} aria-hidden /> Ask a question</span>}
      hint="No evidence needed. Only your question is sent."
      className="ai-ask"
    >
      <div className="ask-box">
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
          }}
          rows={2}
          maxLength={4000}
          placeholder="Ask anything about security concepts, tools, methodology or report writing…"
          aria-label="Question for the AI"
        />
        <button className="btn primary" onClick={submit} disabled={!connected || PREVIEW || !q.trim() || ask.isPending} title={!connected ? 'Connect an AI provider in Settings first' : 'Ctrl+Enter'}>
          {ask.isPending ? <span className="spinner" /> : <Send />} {ask.isPending ? 'Thinking…' : 'Ask'}
        </button>
      </div>
      {!answers.length && !ask.isPending && (
        <div className="ask-examples">
          {EXAMPLES.map((x) => (
            <button key={x} className="chip-btn" onClick={() => setQ(x)}>{x}</button>
          ))}
        </div>
      )}
      {!connected && <p className="small faint" style={{ margin: '8px 0 0' }}>Connect an AI provider in Settings to ask questions.</p>}
      {err && <p className="small" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p>}
      {answers.map((a) => (
        <div key={a.id} className="ask-answer">
          <div className="ask-q">{a.question}</div>
          {a.response_text ? <Markdown text={a.response_text} /> : <p className="small" style={{ color: 'var(--bad)' }}>{a.error ?? 'No answer was returned.'}</p>}
          <div className="ask-meta">
            <Badge tone="warn">General answer, not evidence</Badge>
            <span className="faint small">{a.code} · {a.model}</span>
            <Link className="small" to={`/ai/${a.id}`}>Open session</Link>
          </div>
        </div>
      ))}
    </Panel>
  );
}
