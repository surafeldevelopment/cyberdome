import { Route, Routes, Link } from 'react-router-dom';
import { Layout } from './components/Layout';
import { EmptyState, ErrorState, Loading } from './components/ui';
import { useEngagement } from './lib/engagement';

import Dashboard from './pages/Dashboard';
import Autopilot from './pages/Autopilot';
import Team from './pages/Team';
import Engagement from './pages/Engagement';
import Recon from './pages/Recon';
import ScanPage from './pages/scan/ScanPage';
import AssetDetail from './pages/scan/AssetDetail';
import ScanImportDetail from './pages/scan/ScanImportDetail';
import VulnsPage from './pages/vulns/VulnsPage';
import FindingDetail from './pages/vulns/FindingDetail';
import AttackPage from './pages/attack/AttackPage';
import AiPage from './pages/ai/AiPage';
import AiSessionDetail from './pages/ai/AiSessionDetail';
import EvidencePage from './pages/evidence/EvidencePage';
import EvidenceDetail from './pages/evidence/EvidenceDetail';
import ReportsPage from './pages/reports/ReportsPage';
import ReportPrint from './pages/reports/ReportPrint';
import ExecutivePrint from './pages/reports/ExecutivePrint';
import Tracker from './pages/Tracker';
import Present from './pages/Present';
import Settings from './pages/Settings';

function NotFound() {
  return (
    <EmptyState title="Page not found" actions={<Link className="btn" to="/">Go to dashboard</Link>}>
      The address does not match any CyberDome view.
    </EmptyState>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { loading, error, current } = useEngagement();
  if (loading) return <Loading label="Loading engagement" />;
  if (error) return <ErrorState error={error} retry={() => location.reload()} />;
  if (!current) return <EmptyState title="No engagement available">The server returned no engagements.</EmptyState>;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      {/* Print layouts render without the application shell. */}
      <Route path="/reports/print" element={<Gate><ReportPrint /></Gate>} />
      <Route path="/reports/executive" element={<Gate><ExecutivePrint /></Gate>} />
      <Route
        path="*"
        element={
          <Layout>
            <Gate>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/autopilot" element={<Autopilot />} />
                <Route path="/team" element={<Team />} />
                <Route path="/engagement" element={<Engagement />} />
                <Route path="/recon" element={<Recon />} />
                <Route path="/scan" element={<ScanPage />} />
                <Route path="/scan/assets/:id" element={<AssetDetail />} />
                <Route path="/scan/imports/:id" element={<ScanImportDetail />} />
                <Route path="/vulnerabilities" element={<VulnsPage />} />
                <Route path="/vulnerabilities/:id" element={<FindingDetail />} />
                <Route path="/attack" element={<AttackPage />} />
                <Route path="/ai" element={<AiPage />} />
                <Route path="/ai/:id" element={<AiSessionDetail />} />
                <Route path="/evidence" element={<EvidencePage />} />
                <Route path="/evidence/:id" element={<EvidenceDetail />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/tracker" element={<Tracker />} />
                <Route path="/present" element={<Present />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Gate>
          </Layout>
        }
      />
    </Routes>
  );
}
