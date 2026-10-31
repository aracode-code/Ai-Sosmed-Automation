import { useState } from 'react';
import { useApi } from '../api';
import {
  EmptyState,
  ErrorBox,
  Loading,
  Section,
  StatusPill,
  formatTime,
  preview,
  shortId
} from '../components';
import type { Campaign, CampaignDetail, ListResponse } from '../types';

export function CampaignsPage({ refreshToken }: { refreshToken: number }): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = useApi<ListResponse<Campaign>>(`/api/v1/campaigns?t=${refreshToken}`);
  const detail = useApi<CampaignDetail>(
    selectedId === null ? null : `/api/v1/campaigns/${selectedId}`
  );

  return (
    <div className="stack">
      <Section title="Campaign">
        {list.loading ? <Loading /> : null}
        {list.error !== null ? <ErrorBox message={list.error} /> : null}
        {list.data !== null && list.data.items.length === 0 ? (
          <EmptyState
            title="Belum ada campaign"
            hint="Buat lewat POST /api/v1/campaigns, lalu atur jadwal lewat POST /api/v1/schedules."
          />
        ) : null}
        {list.data !== null && list.data.items.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Niche</th>
                <th>Platform</th>
                <th>Approval</th>
                <th>Status</th>
                <th>Dibuat</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((campaign) => (
                <tr
                  key={campaign.id}
                  className={campaign.id === selectedId ? 'row row-active' : 'row'}
                  onClick={() => setSelectedId(campaign.id)}
                >
                  <td>
                    <div className="cell-main">{campaign.name}</div>
                    <div className="cell-sub mono">{shortId(campaign.id)}</div>
                  </td>
                  <td>{campaign.niche}</td>
                  <td className="mono">{campaign.platforms.join(', ')}</td>
                  <td>{campaign.approvalMode}</td>
                  <td>
                    <StatusPill value={campaign.status} />
                  </td>
                  <td>{formatTime(campaign.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>

      {selectedId !== null ? (
        <Section
          title="Konten campaign"
          actions={
            <button type="button" className="btn" onClick={() => setSelectedId(null)}>
              Tutup
            </button>
          }
        >
          {detail.loading ? <Loading /> : null}
          {detail.error !== null ? <ErrorBox message={detail.error} /> : null}
          {detail.data !== null && detail.data.content.length === 0 ? (
            <EmptyState
              title="Belum ada konten"
              hint="Konten dibuat oleh job PLAN_CONTENT pada slot jadwal, atau lewat POST /api/v1/content."
            />
          ) : null}
          {detail.data !== null && detail.data.content.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Versi</th>
                  <th>Topik</th>
                  <th>Caption</th>
                  <th>Approval</th>
                  <th>ID</th>
                </tr>
              </thead>
              <tbody>
                {detail.data.content.map((item) => (
                  <tr key={`${item.id}-v${item.version}`} className="row">
                    <td className="mono">v{item.version}</td>
                    <td>{item.topic}</td>
                    <td className="caption-cell">{preview(item.caption)}</td>
                    <td>
                      <StatusPill value={item.approvalStatus} />
                    </td>
                    <td className="mono">{shortId(item.id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}
