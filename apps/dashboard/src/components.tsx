import type { ReactNode } from 'react';

const TONES: Record<string, string> = {
  PUBLISHED: 'ok',
  COMPLETED: 'ok',
  connected: 'ok',
  approved: 'ok',
  valid: 'ok',
  not_required: 'muted',
  NEEDS_ATTENTION: 'warn',
  RETRY_WAIT: 'warn',
  pending: 'warn',
  reauth_required: 'warn',
  QUEUED: 'info',
  SCHEDULED: 'info',
  PUBLISHING: 'info',
  VERIFYING: 'info',
  PUBLISH_SUBMITTED: 'info',
  PROCESSING: 'info',
  GENERATING: 'info',
  FAILED: 'danger',
  PERMANENT_FAILURE: 'danger',
  CANCELLED: 'danger',
  rejected: 'danger',
  disconnected: 'danger'
};

export function StatusPill({ value }: { value: string }): JSX.Element {
  const tone = TONES[value] ?? 'muted';
  return (
    <span className={`pill pill-${tone}`} title={value}>
      {value}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }): JSX.Element {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      <p className="empty-hint">{hint}</p>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }): JSX.Element {
  return (
    <div className="error-box" role="alert">
      <span>{message}</span>
      {onRetry !== undefined ? (
        <button type="button" className="btn" onClick={onRetry}>
          Coba lagi
        </button>
      ) : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral'
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'danger';
}): JSX.Element {
  return (
    <div className={`stat stat-${tone}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint === undefined ? null : <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function Loading(): JSX.Element {
  return <div className="loading">Memuat…</div>;
}

export function Section({
  title,
  actions,
  children
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{title}</h2>
        {actions !== undefined ? <div className="panel-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function shortId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 8)}…`;
}

export function formatTime(value: string | null): string {
  if (value === null) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function preview(value: unknown, limit = 120): string {
  if (value === null || value === undefined) return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return '—';
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}
