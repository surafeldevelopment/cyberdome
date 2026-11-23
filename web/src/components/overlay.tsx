import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, XCircle, Info } from 'lucide-react';

/* ---------- Focus trap shared by Drawer & Modal ---------- */
function useFocusTrap(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? []);
    setTimeout(() => (focusables()[0] ?? el)?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);
  return ref;
}

export function Drawer({ open, onClose, title, subtitle, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useFocusTrap(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Details'} ref={ref} tabIndex={-1}>
        <div className="drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{title}</h2>
            {subtitle && <div className="muted small" style={{ marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

export function Modal({ open, onClose, title, children, footer, size }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'wide' | 'narrow' }) {
  const ref = useFocusTrap(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Dialog'} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <h2 style={{ flex: 1, fontSize: '1.12rem' }}>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

/** Confirmation dialog for destructive actions. Optionally requires typing a phrase. */
export function ConfirmDialog({
  open, onClose, onConfirm, title, children, confirmLabel = 'Confirm', danger = true, requireText, busy, confirmDisabled,
}: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; children?: ReactNode; confirmLabel?: string; danger?: boolean; requireText?: string; busy?: boolean; confirmDisabled?: boolean }) {
  const [typed, setTyped] = useState('');
  useEffect(() => setTyped(''), [open]);
  const ok = !requireText || typed === requireText;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="narrow"
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={!ok || busy || confirmDisabled} onClick={onConfirm}>
            {busy && <span className="spinner" />} {confirmLabel}
          </button>
        </>
      }
    >
      <div className="stack tight">
        {children}
        {requireText && (
          <div className="field">
            <label htmlFor="confirm-text">
              Type <code>{requireText}</code> to confirm
            </label>
            <input id="confirm-text" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ---------- Toasts ---------- */
type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; kind: ToastKind; text: string }
const ToastCtx = createContext<(kind: ToastKind, text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 8000 : 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'success' ? <CheckCircle2 /> : t.kind === 'error' ? <XCircle /> : <Info />}
            <div style={{ flex: 1 }}>{t.text}</div>
            <button className="btn ghost icon sm" aria-label="Dismiss" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}>
              <X />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return { success: (t: string) => push('success', t), error: (t: string) => push('error', t), info: (t: string) => push('info', t) };
}
