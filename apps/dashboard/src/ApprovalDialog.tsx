import { useState } from 'react';
import { ApiError, sendJson, useApi } from './api';
import { ErrorBox, Loading, StatusPill, preview, shortId } from './components';
import type { ApprovalRecord, ContentDetail } from './types';

interface ApprovalDialogProps {
  contentId: string;
  version: number;
  onClose: () => void;
  onDecided: () => void;
}

type Decision = 'approved' | 'rejected';

export function ApprovalDialog({
  contentId,
  version,
  onClose,
  onDecided
}: ApprovalDialogProps): JSX.Element {
  const detail = useApi<ContentDetail>(`/api/v1/content/${contentId}?version=${version}`);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = detail.data;
  const assets = data === null ? [] : data.assets;
  const accounts = data === null ? [] : data.accounts;
  const validAssets = assets.filter((asset) => asset.validationStatus === 'valid');
  const connectedAccounts = accounts.filter((account) => account.connectionStatus === 'connected');

  const activeAsset = validAssets.find((asset) => asset.id === assetId) ?? validAssets[0] ?? null;
  const activeAccount =
    connectedAccounts.find((account) => account.id === accountId) ?? connectedAccounts[0] ?? null;

  const blockedReason =
    data === null
      ? null
      : validAssets.length === 0
        ? 'Konten belum punya aset valid — jalankan GENERATE_VIDEO lebih dulu.'
        : connectedAccounts.length === 0
          ? 'Tidak ada akun terhubung untuk platform campaign ini — pairing lewat CLI.'
          : null;

  async function decide(decision: Decision): Promise<void> {
    if (data === null || activeAsset === null || activeAccount === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await sendJson<{ approval: ApprovalRecord }>(
        `/api/v1/content/${contentId}/${decision === 'approved' ? 'approve' : 'reject'}`,
        {
          version: data.content.version,
          assetSha256: activeAsset.sha256,
          captionHash: data.captionHash,
          accountId: activeAccount.id,
          platform: activeAccount.platform,
          ...(reason.trim() === '' ? {} : { reason: reason.trim() })
        }
      );
      onDecided();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.code === 'APPROVAL_MISMATCH'
            ? 'Konten berubah sejak dialog dibuka. Tutup lalu muat ulang daftar.'
            : `${caught.code}: ${caught.message}`
          : caught instanceof Error
            ? caught.message
            : 'kesalahan tidak dikenal'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Tinjau konten">
      <div className="dialog">
        <header className="dialog-head">
          <div>
            <h2>Tinjau konten</h2>
            <p className="dialog-sub mono">
              {shortId(contentId)} · v{version}
            </p>
          </div>
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>
            Tutup
          </button>
        </header>

        {detail.loading ? <Loading /> : null}
        {detail.error !== null ? <ErrorBox message={detail.error} /> : null}

        {data !== null ? (
          <div className="dialog-body">
            <dl className="kv">
              <dt>Campaign</dt>
              <dd>
                {data.campaign.name}
                <span className="muted"> · {data.campaign.platforms.join(', ')}</span>
              </dd>
              <dt>Topik</dt>
              <dd>{data.content.topic}</dd>
              <dt>Status</dt>
              <dd>
                <StatusPill value={data.content.approvalStatus} />
              </dd>
              <dt>Caption</dt>
              <dd className="caption-block">{preview(data.content.caption, 400)}</dd>
              <dt>captionHash</dt>
              <dd className="mono sha">{data.captionHash}</dd>
            </dl>

            <div className="field">
              <span className="field-label">Aset</span>
              {assets.length === 0 ? (
                <p className="hint">Belum ada aset untuk konten ini.</p>
              ) : (
                <ul className="asset-list">
                  {assets.map((asset) => (
                    <li key={asset.id}>
                      <label
                        className={
                          asset.validationStatus === 'valid' ? 'asset' : 'asset asset-disabled'
                        }
                      >
                        <input
                          type="radio"
                          name="asset"
                          checked={activeAsset?.id === asset.id}
                          disabled={asset.validationStatus !== 'valid' || submitting}
                          onChange={() => setAssetId(asset.id)}
                        />
                        <span className="mono">{shortId(asset.sha256)}</span>
                        <span className="muted">
                          {asset.mimeType} · {Math.round(asset.sizeBytes / 1024)} KB
                          {asset.durationMs === null
                            ? ''
                            : ` · ${Math.round(asset.durationMs / 1000)} s`}
                        </span>
                        <StatusPill value={asset.validationStatus} />
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="approval-account">
                Akun
              </label>
              {accounts.length === 0 ? (
                <p className="hint">Belum ada akun untuk platform campaign ini.</p>
              ) : (
                <select
                  id="approval-account"
                  className="input"
                  value={activeAccount?.id ?? ''}
                  disabled={submitting}
                  onChange={(event) => setAccountId(event.target.value)}
                >
                  {accounts.map((account) => (
                    <option
                      key={account.id}
                      value={account.id}
                      disabled={account.connectionStatus !== 'connected'}
                    >
                      {account.label} · {account.platform} · {account.connectionStatus}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="approval-reason">
                Alasan (opsional)
              </label>
              <textarea
                id="approval-reason"
                className="input textarea"
                rows={2}
                maxLength={500}
                value={reason}
                disabled={submitting}
                onChange={(event) => setReason(event.target.value)}
                placeholder="catatan untuk audit"
              />
            </div>

            {blockedReason !== null ? <div className="notice">{blockedReason}</div> : null}
            {error !== null ? <ErrorBox message={error} /> : null}
          </div>
        ) : null}

        <footer className="dialog-foot">
          <span className="muted mono">
            {data === null ? '' : `binding v${data.content.version}`}
          </span>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose} disabled={submitting}>
              Batal
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={submitting || blockedReason !== null}
              onClick={() => void decide('rejected')}
            >
              Tolak
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={submitting || blockedReason !== null}
              onClick={() => void decide('approved')}
            >
              Setujui
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
