import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, getJson, sendJson, useApi } from '../api';
import { EmptyState, ErrorBox, Loading, Section, StatusPill, formatTime, shortId } from '../components';
import type {
  AiCredentialStatusPayload,
  ConnectActionKind,
  ConnectActionPhase,
  ConnectActionState,
  ConnectActionsPayload,
  ConnectionsPayload
} from '../types';

const PHASE_LABELS: Record<ConnectActionPhase, string> = {
  idle: 'belum dijalankan',
  running: 'berjalan',
  waiting: 'menunggu interaksi',
  succeeded: 'selesai',
  failed: 'gagal',
  timed_out: 'waktu habis',
  cancelled: 'dihentikan'
};

const PHASE_TONES: Record<ConnectActionPhase, 'ok' | 'warn' | 'danger' | 'muted' | 'info'> = {
  idle: 'muted',
  running: 'info',
  waiting: 'warn',
  succeeded: 'ok',
  failed: 'danger',
  timed_out: 'danger',
  cancelled: 'muted'
};

function isBusy(action: ConnectActionState): boolean {
  return action.phase === 'running' || action.phase === 'waiting';
}

function messageOf(error: unknown): string {
  return error instanceof ApiError
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : 'kesalahan tidak dikenal';
}

function Tone({
  tone,
  children
}: {
  tone: 'ok' | 'warn' | 'danger' | 'muted';
  children: ReactNode;
}): JSX.Element {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function Ready({ value, label }: { value: boolean; label: string }): JSX.Element {
  return (
    <span className={value ? 'pill pill-ok' : 'pill pill-danger'}>
      {value ? 'siap' : label}
    </span>
  );
}

function ActionStatus({
  action,
  onStop
}: {
  action: ConnectActionState;
  onStop: () => void;
}): JSX.Element | null {
  if (action.phase === 'idle') return null;
  const tone = PHASE_TONES[action.phase];

  return (
    <div className={`action-box action-${tone}`}>
      <div className="action-head">
        <span className={`pill pill-${tone}`}>{PHASE_LABELS[action.phase]}</span>
        <span className="muted">
          {action.startedAt === null ? '' : `mulai ${formatTime(action.startedAt)}`}
          {action.endedAt === null ? '' : ` · selesai ${formatTime(action.endedAt)}`}
          {action.exitCode === null ? '' : ` · exit ${action.exitCode}`}
        </span>
        {isBusy(action) ? (
          <button type="button" className="btn btn-danger" onClick={onStop}>
            Hentikan
          </button>
        ) : null}
      </div>
      {action.waitingFor === null ? null : (
        <p className="action-wait">
          {action.waitingFor} — selesaikan di jendela browser, bukan di halaman ini.
        </p>
      )}
      {action.error === null ? null : <p className="action-wait">{action.error}</p>}
      {action.lines.length === 0 ? null : (
        <pre className="action-log" aria-label="Keluaran proses">
          {action.lines.join('\n')}
        </pre>
      )}
    </div>
  );
}

export function ConnectionsPage({
  refreshToken,
  onChanged
}: {
  refreshToken: number;
  onChanged?: () => void;
}): JSX.Element {
  const [localToken, setLocalToken] = useState(0);
  const data = useApi<ConnectionsPayload>(`/api/v1/connections?t=${refreshToken}-${localToken}`);

  const [aiToken, setAiToken] = useState(0);
  const aiStatus = useApi<AiCredentialStatusPayload>(
    `/api/v1/ai/status?t=${refreshToken}-${aiToken}`
  );
  const [apiKey, setApiKey] = useState('');
  const [keyPending, setKeyPending] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySaved, setKeySaved] = useState(false);

  const [actions, setActions] = useState<ConnectActionsPayload | null>(null);
  const [pollKey, setPollKey] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [flowPending, setFlowPending] = useState(false);
  const [pairPending, setPairPending] = useState(false);
  const [pairTarget, setPairTarget] = useState('');
  const [pairLabel, setPairLabel] = useState('');
  const wasBusy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = (): void => {
      getJson<ConnectActionsPayload>('/api/v1/connections/actions')
        .then((payload) => {
          if (cancelled) return;
          setActions(payload);
          const busy = isBusy(payload.actions.flowLogin) || isBusy(payload.actions.youtubePair);
          if (busy) {
            timer = setTimeout(load, 2000);
          } else if (wasBusy.current) {
            setLocalToken((value) => value + 1);
            onChanged?.();
          }
          wasBusy.current = busy;
        })
        .catch((error: unknown) => {
          if (!cancelled) setActionError(messageOf(error));
        });
    };

    load();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [refreshToken, pollKey, onChanged]);

  const runFlowLogin = async (): Promise<void> => {
    setActionError(null);
    setFlowPending(true);
    try {
      await sendJson<{ action: ConnectActionState }>('/api/v1/connections/flow/login', {});
      setPollKey((value) => value + 1);
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      setFlowPending(false);
    }
  };

  const runPairing = async (): Promise<void> => {
    setActionError(null);
    setPairPending(true);
    try {
      const body =
        pairTarget === '' ? { label: pairLabel.trim() } : { accountId: pairTarget };
      await sendJson<{ action: ConnectActionState }>('/api/v1/connections/youtube/pair', body);
      setPollKey((value) => value + 1);
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      setPairPending(false);
    }
  };

  const stopAction = async (kind: ConnectActionKind): Promise<void> => {
    setActionError(null);
    try {
      await sendJson<{ action: ConnectActionState }>(
        `/api/v1/connections/actions/${kind}/stop`,
        {}
      );
      setPollKey((value) => value + 1);
    } catch (error) {
      setActionError(messageOf(error));
    }
  };

  const saveApiKey = async (): Promise<void> => {
    setKeyError(null);
    setKeySaved(false);
    setKeyPending(true);
    try {
      await sendJson<{ configured: boolean }>('/api/v1/ai/credentials', {
        apiKey: apiKey.trim()
      });
      setApiKey('');
      setKeySaved(true);
      setAiToken((value) => value + 1);
    } catch (error) {
      setKeyError(messageOf(error));
    } finally {
      setKeyPending(false);
    }
  };

  if (data.loading) return <Loading />;
  if (data.error !== null) return <ErrorBox message={data.error} />;
  if (data.data === null) return <EmptyState title="Tidak ada data" hint="Endpoint connections kosong." />;

  const { flow, usage, accounts, platforms } = data.data;
  const flowLogin = actions?.actions.flowLogin ?? null;
  const youtubePair = actions?.actions.youtubePair ?? null;
  const flowRunning = flowLogin !== null && isBusy(flowLogin);
  const pairRunning = youtubePair !== null && isBusy(youtubePair);
  const youtubeAccounts = accounts.filter((account) => account.platform === 'youtube');
  const canPair = pairTarget !== '' || pairLabel.trim() !== '';

  return (
    <div className="stack">
      {actionError !== null ? <ErrorBox message={actionError} /> : null}

      <Section
        title="Browser & Google Flow"
        actions={
          <div className="detail-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void runFlowLogin()}
              disabled={flowPending || flowRunning}
            >
              Buka jendela login Flow
            </button>
          </div>
        }
      >
        <div className="panel-pad">
          <dl className="kv">
            <dt>Adapter</dt>
            <dd>
              <Tone tone={flow.adapter === 'real' ? 'ok' : 'warn'}>{flow.adapter}</Tone>
            </dd>
            <dt>Endpoint CDP</dt>
            <dd className="mono">{flow.cdpEndpoint}</dd>
            <dt>Terjangkau</dt>
            <dd>
              <Ready value={flow.reachable} label="tidak terjangkau" />
            </dd>
            <dt>Tab project</dt>
            <dd>
              <Ready value={flow.pageOpen} label="belum dibuka" />
            </dd>
            <dt>Kolom prompt</dt>
            <dd>
              <Ready value={flow.promptPresent} label="tidak ditemukan" />
            </dd>
            <dt>Privasi unggahan</dt>
            <dd>{flow.privacy}</dd>
            <dt>Status app OAuth</dt>
            <dd>{flow.appStatus}</dd>
            <dt>Kuota hari ini</dt>
            <dd>
              <Tone tone={usage.usedToday >= usage.guard.maxPerDay ? 'warn' : 'muted'}>
                {usage.usedToday}/{usage.guard.maxPerDay}
              </Tone>{' '}
              · {usage.day}
              {usage.usedToday >= usage.guard.maxPerDay ? ' · batas tercapai' : ''}
              {usage.guard.requireConfirm ? ' · konfirmasi wajib' : ''}
            </dd>
            {flow.detail === null ? null : (
              <>
                <dt>Keterangan</dt>
                <dd className="mono">{flow.detail}</dd>
              </>
            )}
          </dl>

          {flowLogin === null ? null : (
            <ActionStatus action={flowLogin} onStop={() => void stopAction('flow-login')} />
          )}

          <div className="notice">
            Tombol di atas menjalankan <code>flow:login</code> di mesin ini: jendela Chrome terbuka,
            Anda login sendiri, lalu tutup jendela. Setelah itu buka satu project di Flow agar tab
            project tersedia. UI tidak pernah menerima kata sandi atau token.
            {flow.reachable && flow.pageOpen ? (
              <>
                {' '}
                Chrome Flow saat ini sudah terbuka dan terhubung lewat CDP; tombol login hanya
                diperlukan bila profil Flow belum punya sesi (tutup Chrome profil itu lebih dulu).
              </>
            ) : null}
          </div>
          {flow.challengeDetected ? (
            <div className="error-box" role="alert">
              Flow menampilkan tantangan verifikasi. Hentikan pekerjaan dan selesaikan manual — tidak ada
              bypass.
            </div>
          ) : null}
        </div>
      </Section>

      <Section title="Kunci AI (DeepSeek)">
        <div className="panel-pad">
          <dl className="kv">
            <dt>Status</dt>
            <dd>
              {aiStatus.loading ? (
                <span className="muted">memuat…</span>
              ) : aiStatus.data === null ? (
                <Tone tone="warn">tidak diketahui</Tone>
              ) : aiStatus.data.configured ? (
                <Tone tone="ok">
                  terkonfigurasi ({aiStatus.data.source === 'store' ? 'DPAPI' : 'environment'})
                </Tone>
              ) : (
                <Tone tone="warn">belum diisi</Tone>
              )}
            </dd>
          </dl>

          <form
            className="pair-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveApiKey();
            }}
          >
            <label className="field">
              <span className="field-label">API key DeepSeek</span>
              <input
                className="input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-…"
                maxLength={200}
                disabled={keyPending}
              />
            </label>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={keyPending || apiKey.trim().length < 10}
            >
              {keyPending ? 'Menyimpan…' : 'Simpan kunci'}
            </button>
          </form>

          {keyError === null ? null : <ErrorBox message={keyError} />}
          {keySaved ? <p className="hint">Kunci tersimpan terenkripsi di mesin ini.</p> : null}
          {aiStatus.data?.storeError === true ? (
            <div className="error-box" role="alert">
              Kredensial tersimpan tidak dapat dibaca. Isi ulang kunci di atas.
            </div>
          ) : null}

          <p className="hint">
            Nilai kunci tidak pernah dikirim balik ke UI atau ditulis ke log. DPAPI menyimpannya per
            user Windows; environment <code>DEEPSEEK_API_KEY</code> tetap menjadi fallback bila
            DPAPI kosong.
          </p>
        </div>
      </Section>

      <Section title="Akun terhubung">
        <div className="panel-pad">
          <form
            className="pair-form"
            onSubmit={(event) => {
              event.preventDefault();
              void runPairing();
            }}
          >
            <label className="field">
              <span className="field-label">Pairing akun YouTube</span>
              <select
                className="input"
                value={pairTarget}
                onChange={(event) => setPairTarget(event.target.value)}
                disabled={pairPending || pairRunning}
              >
                <option value="">— akun baru —</option>
                {youtubeAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label} ({account.connectionStatus})
                  </option>
                ))}
              </select>
            </label>
            {pairTarget === '' ? (
              <label className="field">
                <span className="field-label">Label akun baru</span>
                <input
                  className="input"
                  value={pairLabel}
                  onChange={(event) => setPairLabel(event.target.value)}
                  placeholder="mis. Kanal Utama"
                  maxLength={80}
                  disabled={pairPending || pairRunning}
                />
              </label>
            ) : null}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={pairPending || pairRunning || !canPair}
            >
              Mulai pairing
            </button>
          </form>

          {youtubePair === null ? null : (
            <ActionStatus action={youtubePair} onStop={() => void stopAction('youtube-pair')} />
          )}

          <p className="hint">
            Pairing membuka browser untuk consent Google. Token disimpan lewat DPAPI di mesin ini dan
            tidak pernah melewati UI. Kredensial OAuth hanya dibaca dari environment.
          </p>
        </div>

        {accounts.length === 0 ? (
          <EmptyState
            title="Belum ada akun"
            hint={'Isi label di atas lalu jalankan pairing, atau lewat CLI: corepack pnpm --filter @saa/local-api pair:youtube --label "<label>"'}
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Akun</th>
                <th>Platform</th>
                <th>Status</th>
                <th>Kredensial</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="row row-static">
                  <td className="cell-main">{account.label}</td>
                  <td className="mono">{account.platform}</td>
                  <td>
                    <StatusPill value={account.connectionStatus} />
                  </td>
                  <td>{account.hasSecretRef ? 'DPAPI tersimpan' : 'belum ada'}</td>
                  <td className="mono">{shortId(account.id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Platform">
        <table className="table">
          <thead>
            <tr>
              <th>Platform</th>
              <th>Didukung</th>
              <th>Adapter</th>
              <th>Generator</th>
            </tr>
          </thead>
          <tbody>
            {platforms.map((platform) => (
              <tr key={platform.id} className="row row-static">
                <td className="mono">{platform.id}</td>
                <td>
                  {platform.supported ? (
                    platform.adapter === 'off' ? (
                      <Tone tone="warn">belum aktif</Tone>
                    ) : (
                      <Tone tone="ok">siap</Tone>
                    )
                  ) : (
                    <Tone tone="muted">belum</Tone>
                  )}
                </td>
                <td className="mono">{platform.adapter}</td>
                <td className="mono">{platform.generator ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="panel-pad">
          <div className="notice">
            Platform selain YouTube belum diimplementasikan (P6) dan menunggu keputusan registrasi aplikasi
            per platform. UI tidak pernah menerima kredensial; pairing tetap lewat proses lokal.
          </div>
        </div>
      </Section>
    </div>
  );
}
