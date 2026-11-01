import { useApi } from '../api';
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
import type { Campaign, DashboardSummary, ListResponse } from '../types';

const ACTIVE_JOB_STATUSES = ['QUEUED', 'RETRY_WAIT', 'SCHEDULED', 'PUBLISHING', 'VERIFYING'];
const ATTENTION_STATUSES = ['NEEDS_ATTENTION', 'FAILED', 'PERMANENT_FAILURE'];

export function OverviewPage({ refreshToken }: { refreshToken: number }): JSX.Element {
  const summary = useApi<DashboardSummary>(`/api/v1/dashboard/summary?t=${refreshToken}`);
  const campaigns = useApi<ListResponse<Campaign>>(`/api/v1/campaigns?t=${refreshToken}`);

  const byJobStatus = summary.data?.jobs.byStatus ?? {};
  const activeJobs = ACTIVE_JOB_STATUSES.reduce((sum, status) => sum + (byJobStatus[status] ?? 0), 0);
  const attentionJobs = ATTENTION_STATUSES.reduce((sum, status) => sum + (byJobStatus[status] ?? 0), 0);
  const pendingApproval = summary.data?.content.pendingApproval ?? 0;
  const connected = summary.data?.accounts.byConnectionStatus.connected ?? 0;
  const reauth = summary.data?.accounts.byConnectionStatus.reauth_required ?? 0;
  const recentCampaigns = campaigns.data?.items.slice(0, 5) ?? [];

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
            label="Akun terhubung"
            value={connected}
            hint={reauth > 0 ? `${reauth} perlu reauth` : 'semua siap'}
            tone={reauth > 0 ? 'warn' : 'neutral'}
          />
        </div>
      ) : null}

      <Section title="Campaign">
        {campaigns.loading ? <Loading /> : null}
        {campaigns.error !== null ? <ErrorBox message={campaigns.error} /> : null}
        {campaigns.data !== null && recentCampaigns.length === 0 ? (
          <EmptyState
            title="Belum ada campaign"
            hint="Buat lewat POST /api/v1/campaigns lalu atur jadwal."
          />
        ) : null}
        {recentCampaigns.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Platform</th>
                <th>Approval</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentCampaigns.map((campaign) => (
                <tr key={campaign.id} className="row row-static">
                  <td>
                    <div className="cell-main">{campaign.name}</div>
                    <div className="cell-sub mono">{shortId(campaign.id)}</div>
                  </td>
                  <td className="mono">{campaign.platforms.join(', ')}</td>
                  <td>{campaign.approvalMode}</td>
                  <td>
                    <StatusPill value={campaign.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>

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
                <tr key={failure.id} className="row row-static">
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
    </div>
  );
}
