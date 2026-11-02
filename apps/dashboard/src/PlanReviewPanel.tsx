import { useState } from 'react';
import { ApiError, sendJson, useApi } from './api';
import {
  EmptyState,
  ErrorBox,
  Loading,
  Section,
  StatusPill,
  formatTime,
  preview,
  shortId
} from './components';
import type { PlanApprovalRecord, PlanReview } from './types';

type Decision = 'approved' | 'rejected';

function describeDecisionError(caught: unknown): string {
  if (!(caught instanceof ApiError)) {
    return caught instanceof Error ? caught.message : 'kesalahan tidak dikenal';
  }
  switch (caught.code) {
    case 'PLAN_MISMATCH':
      return 'Rencana berubah sejak ditampilkan. Muat ulang sebelum memutuskan.';
    case 'PLAN_ALREADY_DECIDED':
      return 'Rencana sudah diputuskan. Tutup lalu muat ulang daftar.';
    case 'PLAN_NOT_READY':
      return 'Perencanaan belum selesai; keputusan belum dapat dikirim.';
    case 'PLAN_EMPTY':
      return 'Rencana tidak memuat konten.';
    case 'PLAN_INVALID':
      return `Rencana tidak dapat diproses: ${caught.message}`;
    default:
      return `${caught.code}: ${caught.message}`;
  }
}

export function PlanReviewPanel({
  jobId,
  onClose,
  onDecided
}: {
  jobId: string;
  onClose: () => void;
  onDecided: (message: string) => void;
}): JSX.Element {
  const [reloadToken, setReloadToken] = useState(0);
  const review = useApi<PlanReview>(
    `/api/v1/plans/${encodeURIComponent(jobId)}?t=${reloadToken}`
  );
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = review.data;
  const approval = data === null ? null : data.approval;
  const required = data?.campaign?.approvalMode === 'required';
  const canDecide =
    data !== null &&
    required &&
    data.plan.status === 'COMPLETED' &&
    data.contents.length > 0 &&
    approval === null;

  const blockedReason =
    data === null
      ? null
      : data.plan.status !== 'COMPLETED'
        ? `Rencana berstatus ${data.plan.status}; keputusan hanya setelah COMPLETED.`
        : data.contents.length === 0
          ? 'Rencana tidak memuat konten.'
          : !required
            ? 'Campaign otomatis — rencana langsung dilanjutkan tanpa keputusan manual.'
            : approval !== null
              ? `Sudah diputuskan: ${approval.decision} oleh ${approval.decidedBy}.`
              : null;

  async function decide(decision: Decision): Promise<void> {
    if (data === null || !canDecide) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await sendJson<{ approval: PlanApprovalRecord; enqueuedJobIds: string[] }>(
        `/api/v1/plans/${encodeURIComponent(jobId)}/${decision === 'approved' ? 'approve' : 'reject'}`,
        {
          bindingHash: data.bindingHash,
          decidedBy: 'local-user',
          ...(reason.trim() === '' ? {} : { reason: reason.trim() })
        }
      );
      onDecided(
        decision === 'approved'
          ? `Rencana disetujui; ${result.enqueuedJobIds.length} job ${
              data.campaign?.generationMode === 'image' ? 'GENERATE_IMAGE' : 'GENERATE_VIDEO'
            } diantrekan.`
          : 'Rencana ditolak; tidak ada job pembuatan media yang dibuat.'
      );
    } catch (caught) {
      setError(describeDecisionError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Section
      title="Tinjauan rencana"
      actions={
        <button type="button" className="btn" onClick={onClose} disabled={submitting}>
          Tutup
        </button>
      }
    >
      {review.loading ? <Loading /> : null}
      {review.error !== null ? (
        <ErrorBox message={review.error} onRetry={() => setReloadToken((value) => value + 1)} />
      ) : null}

      {data !== null ? (
        <>
          <div className="panel-pad">
            <dl className="kv">
              <dt>Job rencana</dt>
              <dd className="mono">{data.plan.jobId}</dd>
              <dt>Status</dt>
              <dd>
                <StatusPill value={data.plan.status} />
              </dd>
              {data.campaign === null ? null : (
                <>
                  <dt>Campaign</dt>
                  <dd>
                    {data.campaign.name}
                    <span className="muted">
                      {' '}
                      · {data.campaign.approvalMode} · {data.campaign.generationMode}
                    </span>
                  </dd>
                </>
              )}
              <dt>Item</dt>
              <dd>{data.contents.length} konten</dd>
              <dt>bindingHash</dt>
              <dd className="mono sha">{data.bindingHash}</dd>
            </dl>

            {approval === null ? null : (
              <div className="notice">
                Keputusan <strong>{approval.decision}</strong> oleh {approval.decidedBy} pada{' '}
                {formatTime(approval.decidedAt)} · {approval.itemCount} item
                {approval.reason === null ? '' : ` · alasan: ${approval.reason}`}
              </div>
            )}
          </div>

          {data.contents.length === 0 ? (
            <EmptyState
              title="Rencana tanpa konten"
              hint="Planner tidak menghasilkan item; ajukan permintaan baru."
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Topik</th>
                  <th>Caption</th>
                  <th>Approval</th>
                  <th>Konten</th>
                </tr>
              </thead>
              <tbody>
                {data.contents.map((item, index) => (
                  <tr key={`${item.id}-v${item.version}`} className="row row-static">
                    <td className="mono">{index + 1}</td>
                    <td>{item.topic}</td>
                    <td className="caption-cell">{preview(item.caption)}</td>
                    <td>
                      <StatusPill value={item.approvalStatus} />
                    </td>
                    <td className="mono">
                      {shortId(item.id)} · v{item.version}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {required && approval === null ? (
            <div className="panel-pad">
              <div className="field">
                <label className="field-label" htmlFor={`plan-reason-${jobId}`}>
                  Alasan (opsional)
                </label>
                <textarea
                  id={`plan-reason-${jobId}`}
                  className="input textarea"
                  rows={2}
                  maxLength={500}
                  value={reason}
                  disabled={submitting}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="catatan keputusan untuk audit"
                />
              </div>
            </div>
          ) : null}

          {blockedReason !== null ? <div className="notice">{blockedReason}</div> : null}
          {error !== null ? <ErrorBox message={error} /> : null}

          {required ? (
            <footer className="dialog-foot">
              <span className="muted mono">binding {shortId(data.bindingHash)}</span>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={!canDecide || submitting}
                  onClick={() => void decide('rejected')}
                >
                  Tolak
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canDecide || submitting}
                  onClick={() => void decide('approved')}
                >
                  {submitting ? 'Menyimpan…' : 'Setujui rencana'}
                </button>
              </div>
            </footer>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}
