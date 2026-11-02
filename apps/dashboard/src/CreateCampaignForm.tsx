import { useState } from 'react';
import { ApiError, sendJson } from './api';
import { ErrorBox, Section } from './components';

const PLATFORM_OPTIONS = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'x', label: 'X' },
  { id: 'threads', label: 'Threads' }
] as const;

type ApprovalMode = 'required' | 'automatic';
type GenerationMode = 'video' | 'image';

export function CreateCampaignForm({
  onCreated
}: {
  onCreated: (campaignId: string) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [niche, setNiche] = useState('');
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('required');
  const [generationMode, setGenerationMode] = useState<GenerationMode>('video');
  const [platforms, setPlatforms] = useState<string[]>(['youtube']);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const valid = name.trim() !== '' && niche.trim() !== '' && platforms.length > 0;

  function togglePlatform(id: string): void {
    setPlatforms((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  async function submit(): Promise<void> {
    if (!valid || submitting) return;
    setSubmitting(true);
    setFormError(null);
    setNotice(null);
    try {
      const created = await sendJson<{ campaignId: string; status: string }>('/api/v1/campaigns', {
        name: name.trim(),
        niche: niche.trim(),
        approvalMode,
        generationMode,
        platforms
      });
      setNotice(`Campaign ${created.campaignId} dibuat. Baris di tabel sudah dipilih.`);
      setName('');
      setNiche('');
      setApprovalMode('required');
      setGenerationMode('video');
      setPlatforms(['youtube']);
      onCreated(created.campaignId);
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
    <Section title="Buat campaign">
      <div className="panel-pad">
        <p className="hint">
          Campaign baru langsung aktif. Mode generasi menentukan artefak yang diproduksi: video
          (dapat diterbitkan ke YouTube) atau gambar. Platform yang sudah punya adapter baru
          YouTube; platform lain dicatat tetapi publikasinya belum didukung.
        </p>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="field">
            <label className="field-label" htmlFor="campaign-name">
              Nama
            </label>
            <input
              id="campaign-name"
              className="input"
              maxLength={120}
              value={name}
              disabled={submitting}
              onChange={(event) => setName(event.target.value)}
              placeholder="mis. Tips Kantor"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="campaign-niche">
              Niche
            </label>
            <input
              id="campaign-niche"
              className="input"
              maxLength={120}
              value={niche}
              disabled={submitting}
              onChange={(event) => setNiche(event.target.value)}
              placeholder="mis. produktivitas kerja"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="campaign-approval">
              Mode approval
            </label>
            <select
              id="campaign-approval"
              className="input"
              value={approvalMode}
              disabled={submitting}
              onChange={(event) => setApprovalMode(event.target.value as ApprovalMode)}
            >
              <option value="required">required — setujui tiap rencana</option>
              <option value="automatic">automatic — rencana langsung diproduksi</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="campaign-generation">
              Mode generasi
            </label>
            <select
              id="campaign-generation"
              className="input"
              value={generationMode}
              disabled={submitting}
              onChange={(event) => setGenerationMode(event.target.value as GenerationMode)}
            >
              <option value="video">video — diproduksi dan dapat diterbitkan</option>
              <option value="image">image — diproduksi, belum diterbitkan</option>
            </select>
          </div>
          <div className="field">
            <span className="field-label">Platform</span>
            <div className="check-row">
              {PLATFORM_OPTIONS.map((option) => (
                <label key={option.id} className="check">
                  <input
                    type="checkbox"
                    checked={platforms.includes(option.id)}
                    disabled={submitting}
                    onChange={() => togglePlatform(option.id)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
          <div className="detail-actions span-2">
            <button type="submit" className="btn btn-primary" disabled={submitting || !valid}>
              {submitting ? 'Membuat…' : 'Buat campaign'}
            </button>
            {platforms.length === 0 ? (
              <span className="hint">Pilih minimal satu platform.</span>
            ) : null}
          </div>
        </form>
        {notice !== null ? <div className="notice notice-ok">{notice}</div> : null}
        {formError !== null ? <ErrorBox message={formError} /> : null}
      </div>
    </Section>
  );
}
