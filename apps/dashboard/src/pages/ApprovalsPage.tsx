import { useEffect, useState } from 'react';
import { ApiError, getJson } from '../api';
import { ApprovalDialog } from '../ApprovalDialog';
import { EmptyState, ErrorBox, Loading, Section, StatusPill, preview, shortId } from '../components';
import type { Campaign, CampaignDetail, ContentItem, ListResponse } from '../types';

interface ApprovalRow {
  campaign: Campaign;
  item: ContentItem;
}

export function ApprovalsPage({
  refreshToken,
  onChanged
}: {
  refreshToken: number;
  onChanged: () => void;
}): JSX.Element {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ contentId: string; version: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
          .map((item) => ({ campaign: detail.campaign, item }))
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
        Setujui atau tolak konten yang menunggu keputusan. Binding yang dikirim (versi, sha256 aset,
        hash caption, akun, platform) diambil ulang dari server saat dialog dibuka; bila konten
        berubah di antaranya, keputusan ditolak dengan <code>APPROVAL_MISMATCH</code>.
      </div>

      {notice !== null ? <div className="notice notice-ok">{notice}</div> : null}

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
                <th aria-label="aksi" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ campaign, item }) => (
                <tr key={`${item.id}-v${item.version}`} className="row row-static">
                  <td>{campaign.name}</td>
                  <td>
                    <div className="cell-main mono">{shortId(item.id)}</div>
                    <div className="cell-sub mono">v{item.version}</div>
                  </td>
                  <td>{item.topic}</td>
                  <td className="caption-cell">{preview(item.caption)}</td>
                  <td>
                    <StatusPill value={item.approvalStatus} />
                  </td>
                  <td className="cell-action">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setSelected({ contentId: item.id, version: item.version })}
                    >
                      Tinjau
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>

      {selected !== null ? (
        <ApprovalDialog
          contentId={selected.contentId}
          version={selected.version}
          onClose={() => setSelected(null)}
          onDecided={() => {
            setSelected(null);
            setNotice('Keputusan tersimpan. Daftar dimuat ulang.');
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}
