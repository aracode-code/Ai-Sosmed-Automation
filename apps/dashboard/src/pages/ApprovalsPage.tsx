import { useEffect, useState } from 'react';
import { ApiError, getJson } from '../api';
import { EmptyState, ErrorBox, Loading, Section, StatusPill, preview, shortId } from '../components';
import type { Campaign, CampaignDetail, ContentItem, ListResponse } from '../types';

interface ApprovalRow {
  campaignName: string;
  item: ContentItem;
}

export function ApprovalsPage({ refreshToken }: { refreshToken: number }): JSX.Element {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void (async () => {
      const campaigns = await getJson<ListResponse<Campaign>>('/api/v1/campaigns', controller.signal);
      const details = await Promise.all(
        campaigns.items.map((campaign) =>
          getJson<CampaignDetail>(`/api/v1/campaigns/${campaign.id}`, controller.signal)
        )
      );
      const pending = details.flatMap((detail) =>
        detail.content
          .filter((item) => item.approvalStatus === 'pending')
          .map((item) => ({ campaignName: detail.campaign.name, item }))
      );
      setRows(pending);
      setLoading(false);
    })().catch((caught: unknown) => {
      if (controller.signal.aborted) return;
      setError(
        caught instanceof ApiError
          ? `${caught.code}: ${caught.message}`
          : caught instanceof Error
            ? caught.message
            : 'kesalahan tidak dikenal'
      );
      setLoading(false);
    });

    return () => controller.abort();
  }, [refreshToken]);

  return (
    <div className="stack">
      <div className="notice">
        Halaman ini hanya menampilkan konten yang menunggu keputusan. Aksi setujui/tolak belum
        tersedia di UI karena binding approval memerlukan <code>assetSha256</code>,{' '}
        <code>captionHash</code>, <code>accountId</code>, dan <code>platform</code> yang belum
        diekspos oleh endpoint mana pun.
      </div>

      <Section title="Menunggu approval">
        {loading ? <Loading /> : null}
        {error !== null ? <ErrorBox message={error} /> : null}
        {!loading && error === null && rows.length === 0 ? (
          <EmptyState
            title="Tidak ada konten menunggu approval"
            hint="Campaign dengan approvalMode=automatic tidak membuat antrean ini."
          />
        ) : null}
        {rows.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Konten</th>
                <th>Topik</th>
                <th>Caption</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ campaignName, item }) => (
                <tr key={`${item.id}-v${item.version}`} className="row">
                  <td>{campaignName}</td>
                  <td>
                    <div className="cell-main mono">{shortId(item.id)}</div>
                    <div className="cell-sub mono">v{item.version}</div>
                  </td>
                  <td>{item.topic}</td>
                  <td className="caption-cell">{preview(item.caption)}</td>
                  <td>
                    <StatusPill value={item.approvalStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>
    </div>
  );
}
