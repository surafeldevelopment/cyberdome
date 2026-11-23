import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/nunito-sans/300.css';
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/500.css';
import '@fontsource/nunito-sans/600.css';
import '@fontsource/nunito-sans/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles/app.css';
import App from './App';
import { EngagementProvider } from './lib/engagement';
import { ToastProvider } from './components/overlay';
import { PREVIEW, setSnapshot } from './lib/api';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } },
});

const Router = PREVIEW ? HashRouter : BrowserRouter;

function render() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <Router>
          <ToastProvider>
            <EngagementProvider>
              <App />
            </EngagementProvider>
          </ToastProvider>
        </Router>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

if (PREVIEW) {
  fetch('snapshot.json')
    .then((r) => r.json())
    .then((s) => {
      setSnapshot(s.responses);
      (window as any).__CYBERDOME_PREVIEW__ = s.meta;
      try {
        if (!localStorage.getItem('cyberdome.engagement') && s.meta?.default_engagement) localStorage.setItem('cyberdome.engagement', s.meta.default_engagement);
      } catch { /* storage unavailable */ }
      render();
    })
    .catch(() => {
      document.getElementById('root')!.textContent = 'The preview snapshot could not be loaded.';
    });
} else {
  render();
}
