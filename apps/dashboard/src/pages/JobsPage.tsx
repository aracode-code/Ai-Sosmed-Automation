import { useState } from 'react';
import { ApiError, sendJson, useApi } from '../api';
import {
  EmptyState,
  ErrorBox,
  Loading,
  Section,
  StatCard,
  StatusPill,
  formatTime,
  shortId
} from '../components';
import type { DashboardSummary, Job, JobTimeline, ListResponse } from '../types';

const FILTERS = [
  'ALL',
  'QUEUED',
  'SCHEDULED',
  'PUBLISHING',
  'VERIFYING',
  'PUBLISHED',
  'RETRY_WAIT',
  'NEEDS_ATTENTION',
  'FAILED',
  'COMPLETED'
] as const;

export function JobsPage({ refreshToken }: { refreshToken: number }): JSX.Element {
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [localToken, setLocalToken] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const token = refreshToken + localToken;

  const query = status === 'ALL' ? '?limit=50' : `?status=${status}&limit=50`;
  const list = useApi<ListResponse<Job>>(`/api/v1/jobs${query}&t=${token}`);
  const summary = useApi<DashboardSummary>(`/api/v1/dashboard/summary?t=${token}`);
  const detail = useApi<Job>(selectedId === null ? null : `/api/v1/jobs/${selectedId}?t=${token}`);
  const timeline = useApi<JobTimeline>(
    selectedId === null ? null : `/api/v1/jobs/${selectedId}/events?t=${token}`
  );

  const byJobStatus = summary.data?.jobs.byStatus ?? {};
  const activeJobs =
    (byJobStatus.QUEUED ?? 0) +
    (byJobStatus.RETRY_WAIT ?? 0) +
    (byJobStatus.SCHEDULED ?? 0) +
    (byJobStatus.PUBLISHING ?? 0) +
    (byJobStatus.VERIFYING ?? 0);
  const attentionJobs =
    (byJobStatus.NEEDS_ATTENTION ?? 0) +
    (byJobStatus.FAILED ?? 0) +
    (byJobStatus.PERMANENT_FAILURE ?? 0);
  const published = summary.data?.publishAttempts.byStatus.published ?? 0;
  const publishTrouble =
    (summary.data?.publishAttempts.byStatus.failed ?? 0) +
    (summary.data?.publishAttempts.byStatus.unknown ?? 0);
  const connected = summary.data?.accounts.byConnectionStatus.connected ?? 0;
  const reauth = summary.data?.accounts.byConnectionStatus.reauth_required ?? 0;
  const pendingApproval = summary.data?.content.pendingApproval ?? 0;

  const TERMINAL_STATUSES = ['PUBLISHED', 'FAILED', 'CANCELLED', 'COMPLETED', 'PERMANENT_FAILURE'];
  const IRREVERSIBLE_STATUSES = ['PUBLISHING', 'VERIFYING'];
  const selectedStatus = detail.data?.status ?? null;
  const canRetry = selectedStatus === 'NEEDS_ATTENTION';
  const canCancel =
    selectedStatus !== null &&
    !TERMINAL_STATUSES.includes(selectedStatus) &&
    !IRREVERSIBLE_STATUSES.includes(selectedStatus);

  async function retrySelected(): Promise<void> {
    if (detail.data === null) return;
    setRetrying(true);
    setActionError(null);
    try {
      await sendJson<{ jobId: string; status: string }>(
        `/api/v1/jobs/${detail.data.id}/retry`,
        {}
      );
      setLocalToken((value) => value + 1);
    } catch (caught) {
      setActionError(
        caught instanceof ApiError
          ? `${caught.code}: ${caught.message}`
          : caught instanceof Error
            ? caught.message
            : 'kesalahan tidak dikenal'
      );
    } finally {
      setRetrying(false);
    }
  }

  async function cancelSelected(): Promise<void> {
    if (detail.data === null) return;
    setCancelling(true);
    setActionError(null);
    try {
      await sendJson<{ jobId: string; status: string }>(
        `/api/v1/jobs/${detail.data.id}/cancel`,
        {}
      );
      setLocalToken((value) => value + 1);
    } catch (caught) {
      setActionError(
        caught instanceof ApiError
          ? `${caught.code}: ${caught.message}`
          : caught instanceof Error
            ? caught.message
            : 'kesalahan tidak dikenal'
      );
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="stack">
      {summary.error !== null ? <ErrorBox message={summary.error} /> : null}
      {summary.data !== null ? (
        <div className="stats">
          <StatCard label="Job aktif" value={activeJobs} hint="queued · retry · dijalankan" />
          <StatCard
            label="Perlu perhatian"
            value={attentionJobs}
            hint="NEEDS_ATTENTION / FAILED"
            tone={attentionJobs > 0 ? 'danger' : 'neutral'}
          />
          <StatCard
            label="Menunggu approval"
            value={pendingApproval}
            hint="konten pending"
            tone={pendingApproval > 0 ? 'warn' : 'neutral'}
          />
          <StatCard
            label="Publikasi terbit"
            value={published}
            hint={publishTrouble > 0 ? `${publishTrouble} gagal/unknown` : 'tanpa kegagalan'}
            tone="ok"
          />
          <StatCard
            label="Akun terhubung"
            value={connected}
            hint={reauth > 0 ? `${reauth} perlu reauth` : 'semua siap'}
            tone={reauth > 0 ? 'warn' : 'neutral'}
          />
        </div>
      ) : null}
      {summary.data !== null && summary.data.recentFailures.length > 0 ? (
        <Section title="Kegagalan terbaru">
          <table className="table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Error</th>
                <th>Diperbarui</th>
              </tr>
            </thead>
            <tbody>
              {summary.data.recentFailures.map((failure) => (
                <tr key={failure.id} className="row" onClick={() => setSelectedId(failure.id)}>
                  <td>
                    <div className="cell-main">{failure.jobType}</div>
                    <div className="cell-sub mono">{shortId(failure.id)}</div>
                  </td>
                  <td>
                    <StatusPill value={failure.status} />
                  </td>
                  <td className="mono">{failure.lastErrorCode ?? '—'}</td>
                  <td>{formatTime(failure.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}
      <div className="filters">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            className={value === status ? 'chip chip-active' : 'chip'}
            onClick={() => {
              setStatus(value);
              setSelectedId(null);
            }}
          >
            {value === 'ALL' ? 'Semua' : value}
          </button>
        ))}
      </div>

      <Section title={`Antrean job${status === 'ALL' ? '' : ` — ${status}`}`}>
        {list.loading ? <Loading /> : null}
        {list.error !== null ? <ErrorBox message={list.error} /> : null}
        {list.data !== null && list.data.items.length === 0 ? (
          <EmptyState
            title="Belum ada job"
            hint="Job dibuat oleh scheduler saat slot jatuh tempo, atau lewat POST /api/v1/content."
          />
        ) : null}
        {list.data !== null && list.data.items.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Attempt</th>
                <th>Jadwal</th>
                <th>Error</th>
                <th>Diperbarui</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((job) => (
                <tr
                  key={job.id}
                  className={job.id === selectedId ? 'row row-active' : 'row'}
                  onClick={() => setSelectedId(job.id)}
                >
                  <td>
                    <div className="cell-main">{job.jobType}</div>
                    <div className="cell-sub mono">{shortId(job.id)}</div>
                  </td>
                  <td>
                    <StatusPill value={job.status} />
                  </td>
                  <td className="mono">
                    {job.attempts}/{job.maxAttempts}
                  </td>
                  <td>{formatTime(job.runAt)}</td>
                  <td className="mono">{job.lastErrorCode ?? '—'}</td>
                  <td>{formatTime(job.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>

      {selectedId !== null ? (
        <Section
          title={`Detail job ${shortId(selectedId)}`}
          actions={
            <div className="detail-actions">
              {canRetry ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void retrySelected()}
                  disabled={retrying}
                >
                  {retrying ? 'Mengulang…' : 'Retry job'}
                </button>
              ) : null}
              {canCancel ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void cancelSelected()}
                  disabled={cancelling}
                >
                  {cancelling ? 'Membatalkan…' : 'Batalkan'}
                </button>
              ) : null}
              <button type="button" className="btn" onClick={() => setSelectedId(null)}>
                Tutup
              </button>
            </div>
          }
        >
          {detail.loading ? <Loading /> : null}
          {detail.error !== null ? <ErrorBox message={detail.error} /> : null}
          {actionError !== null ? <ErrorBox message={actionError} /> : null}
          {detail.data !== null ? <JobDetail job={detail.data} /> : null}
          {timeline.loading ? <Loading /> : null}
          {timeline.error !== null ? <ErrorBox message={timeline.error} /> : null}
          {timeline.data !== null && timeline.data.attempts.length > 0 ? (
            <div className="panel-pad">
              <p className="detail-label">Percobaan publikasi</p>
              <table className="table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Platform</th>
                    <th>Error</th>
                    <th>External ID</th>
                    <th>Waktu</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.data.attempts.map((attempt) => (
                    <tr key={attempt.id} className="row row-static">
                      <td>
                        <StatusPill value={attempt.status} />
                      </td>
                      <td className="mono">{attempt.platform}</td>
                      <td className="mono">{attempt.errorCode ?? '—'}</td>
                      <td className="mono">{attempt.externalPostId ?? '—'}</td>
                      <td>{formatTime(attempt.attemptedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {timeline.data !== null && timeline.data.events.length > 0 ? (
            <div className="panel-pad">
              <p className="detail-label">Riwayat aksi</p>
              <table className="table">
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Aksi</th>
                    <th>Hasil</th>
                    <th>Aktor</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.data.events.map((event) => (
                    <tr key={event.id} className="row row-static">
                      <td>{formatTime(event.createdAt)}</td>
                      <td className="mono">{event.action}</td>
                      <td>{event.result}</td>
                      <td className="mono">{event.actorId ?? event.actorType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}

function JobDetail({ job }: { job: Job }): JSX.Element {
  return (
    <div className="detail-grid">
      <dl className="kv">
        <dt>ID</dt>
        <dd className="mono">{job.id}</dd>
        <dt>Tipe</dt>
        <dd>{job.jobType}</dd>
        <dt>Status</dt>
        <dd>
          <StatusPill value={job.status} />
        </dd>
        <dt>Campaign</dt>
        <dd className="mono">{job.campaignId ?? '—'}</dd>
        <dt>Konten</dt>
        <dd className="mono">{job.contentId ?? '—'}</dd>
        <dt>Kunci idempoten</dt>
        <dd className="mono">{job.idempotencyKey}</dd>
        <dt>Lease</dt>
        <dd className="mono">
          {job.leaseOwner ?? '—'}
          {job.leaseUntil === null ? '' : ` · s.d. ${formatTime(job.leaseUntil)}`}
        </dd>
        <dt>Dibuat</dt>
        <dd>{formatTime(job.createdAt)}</dd>
        <dt>Diperbarui</dt>
        <dd>{formatTime(job.updatedAt)}</dd>
      </dl>
      <div>
        <p className="detail-label">Payload</p>
        <pre className="code">{JSON.stringify(job.payload, null, 2)}</pre>
      </div>
    </div>
  );
}
