import { useEffect, useState } from 'react';
import { ApiError, sendJson, useApi } from '../api';
import { PlanReviewPanel } from '../PlanReviewPanel';
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
import type { Campaign, CampaignDetail, Job, ListResponse } from '../types';

export function CampaignsPage({
  refreshToken,
  onChanged
}: {
  refreshToken: number;
  onChanged: () => void;
}): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [planJobId, setPlanJobId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const list = useApi<ListResponse<Campaign>>(`/api/v1/campaigns?t=${refreshToken}`);
  const detail = useApi<CampaignDetail>(
    selectedId === null
      ? null
      : `/api/v1/campaigns/${encodeURIComponent(selectedId)}?t=${refreshToken}`
  );
  const plans = useApi<ListResponse<Job>>(
    selectedId === null
      ? null
      : `/api/v1/jobs?jobType=PLAN_CONTENT&campaignId=${encodeURIComponent(selectedId)}&limit=5&t=${refreshToken}`
  );

  const selectedCampaign = list.data?.items.find((campaign) => campaign.id === selectedId) ?? null;

  useEffect(() => {
    setPlanJobId(null);
    setNotes('');
    setNotice(null);
    setFormError(null);
  }, [selectedId]);

  const blockedRequest =
    selectedCampaign === null
      ? null
      : selectedCampaign.status !== 'active'
        ? `Campaign berstatus ${selectedCampaign.status}; aktifkan dulu sebelum meminta rencana.`
        : selectedCampaign.platforms.length === 0
          ? 'Campaign belum punya platform target.'
          : null;

  async function requestPlan(): Promise<void> {
    if (selectedCampaign === null || blockedRequest !== null) return;
    setSubmitting(true);
    setFormError(null);
    setNotice(null);
    try {
      const created = await sendJson<{ jobId: string; status: string }>('/api/v1/content', {
        campaignId: selectedCampaign.id,
        ...(notes.trim() === '' ? {} : { notes: notes.trim() })
      });
      setNotes('');
      setNotice(
        created.status === 'duplicate'
          ? `Permintaan ini sudah ada sebagai job ${created.jobId}.`
          : `Job rencana ${created.jobId} dibuat (${created.status}). Setelah COMPLETED, tinjau di daftar bawah.`
      );
      onChanged();
    } catch (caught) {
      setFormError(
        caught instanceof ApiError
          ? `${caught.code}: ${caught.message}`
          : caught instanceof Error
            ? caught.message
            : 'kesalahan tidak dikenal'
      );
    } finally {
      setSubmitting(false);
    }
  }

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

      {selectedCampaign !== null ? (
        <Section
          title={`Permintaan approval · ${selectedCampaign.name}`}
          actions={
            <button type="button" className="btn" onClick={() => setSelectedId(null)}>
              Tutup
            </button>
          }
        >
          <div className="panel-pad">
            <p className="hint">
              Form ini membuat job PLAN_CONTENT untuk rencana berikutnya.
              {selectedCampaign.approvalMode === 'required'
                ? ' Karena approval wajib, pembuatan video baru diantrekan setelah rencana disetujui.'
                : ' Campaign otomatis: rencana yang selesai langsung dilanjutkan ke pembuatan video.'}
            </p>
            <form
              className="field"
              onSubmit={(event) => {
                event.preventDefault();
                void requestPlan();
              }}
            >
              <label className="field-label" htmlFor="plan-notes">
                Catatan untuk planner (opsional)
              </label>
              <textarea
                id="plan-notes"
                className="input textarea"
                rows={2}
                maxLength={2000}
                value={notes}
                disabled={submitting || blockedRequest !== null}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="mis. fokus promo akhir pekan"
              />
              <div className="detail-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting || blockedRequest !== null}
                >
                  {submitting ? 'Mengirim…' : 'Minta rencana'}
                </button>
              </div>
            </form>
            {blockedRequest !== null ? <div className="notice">{blockedRequest}</div> : null}
            {notice !== null ? <div className="notice notice-ok">{notice}</div> : null}
            {formError !== null ? <ErrorBox message={formError} /> : null}
          </div>

          {plans.loading ? <Loading /> : null}
          {plans.error !== null ? <ErrorBox message={plans.error} /> : null}
          {plans.data !== null && plans.data.items.length === 0 ? (
            <EmptyState
              title="Belum ada permintaan rencana"
              hint="Kirim form di atas; job PLAN_CONTENT akan muncul di sini."
            />
          ) : null}
          {plans.data !== null && plans.data.items.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Dibuat</th>
                  <th>Status</th>
                  <th>Job</th>
                  <th aria-label="aksi" />
                </tr>
              </thead>
              <tbody>
                {plans.data.items.map((job) => (
                  <tr
                    key={job.id}
                    className={job.id === planJobId ? 'row row-static row-active' : 'row row-static'}
                  >
                    <td>{formatTime(job.createdAt)}</td>
                    <td>
                      <StatusPill value={job.status} />
                    </td>
                    <td className="mono">{shortId(job.id)}</td>
                    <td className="cell-action">
                      <button type="button" className="btn" onClick={() => setPlanJobId(job.id)}>
                        Tinjau
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Section>
      ) : null}

      {planJobId !== null ? (
        <PlanReviewPanel
          jobId={planJobId}
          onClose={() => setPlanJobId(null)}
          onDecided={(message) => {
            setPlanJobId(null);
            setNotice(message);
            onChanged();
          }}
        />
      ) : null}

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
              hint="Konten dibuat oleh job PLAN_CONTENT pada slot jadwal, atau lewat form permintaan di atas."
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
