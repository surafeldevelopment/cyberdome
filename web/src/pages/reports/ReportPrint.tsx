import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { ErrorState, Loading } from '../../components/ui';
import { ReportDoc, useRendered } from './shared';
import '../../styles/reports.css';

/** Standalone light print layout. Use the browser's Print → Save as PDF. */
export function PrintView({ kind }: { kind: 'full' | 'executive' }) {
  const q = useRendered(kind);
  useEffect(() => {
    document.body.classList.add('print-route');
    document.documentElement.classList.add('print-route');
    return () => {
      document.body.classList.remove('print-route');
      document.documentElement.classList.remove('print-route');
    };
  }, []);
  useEffect(() => {
    if (q.data) document.title = kind === 'full' ? q.data.title : `Executive summary · ${q.data.title}`;
    return () => { document.title = 'CyberDome Command Center'; };
  }, [q.data, kind]);
  return (
    <div className="print-shell">
      <div className="print-toolbar">
        <Link to="/reports?tab=export" className="btn sm"><ArrowLeft /> Back to Reports</Link>
        <span className="small">
          {kind === 'full' ? 'Technical report' : 'One-page executive summary'}. Print layout. Choose “Save as PDF” as the printer.
          {q.data && q.data.status !== 'final' && ' This report is a draft and is labeled DRAFT.'}
        </span>
        <button className="btn sm primary" onClick={() => window.print()} disabled={!q.data}><Printer /> Print / Save as PDF</button>
      </div>
      <div className={`print-page ${kind}`}>
        {q.isLoading && <Loading />}
        {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
        {q.data && <ReportDoc html={q.data.html} />}
      </div>
    </div>
  );
}

export default function ReportPrint() {
  return <PrintView kind="full" />;
}
