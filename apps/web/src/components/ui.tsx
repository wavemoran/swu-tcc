import type { ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Link } from '../router.tsx';

/** `// label` section label: violet slashes, muted text. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="tcc-label">
      <span className="slashes" aria-hidden="true">
        //
      </span>{' '}
      {children}
    </span>
  );
}

export function Loading({ label, progress }: { label: string; progress?: { done: number; total: number } }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <Loader2 className="spin" size={24} aria-hidden="true" />
      <p>{label}</p>
      {progress && progress.total > 0 && (
        <p className="mono-note">
          {progress.done} / {progress.total} REQUESTS
        </p>
      )}
    </div>
  );
}

export function Notice({
  title,
  children,
  actions,
  tone = 'error',
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  tone?: 'error' | 'info';
}) {
  return (
    <div className={`state notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <AlertTriangle size={24} aria-hidden="true" />
      <h2>{title}</h2>
      {children && <div className="notice-body">{children}</div>}
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function ManualLink() {
  return (
    <Link to="/manual" className="btn secondary">
      Enter standings by hand
    </Link>
  );
}
