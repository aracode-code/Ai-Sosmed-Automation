import type { ReactNode } from 'react';
import { useApi } from '../api';
import { EmptyState, ErrorBox, Loading, Section, StatusPill, shortId } from '../components';
import type { ConnectionsPayload } from '../types';

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

export function ConnectionsPage({ refreshToken }: { refreshToken: number }): JSX.Element {
  const data = useApi<ConnectionsPayload>(`/api/v1/connections?t=${refreshToken}`);

  if (data.loading) return <Loading />;
  if (data.error !== null) return <ErrorBox message={data.error} />;
  if (data.data === null) return <EmptyState title="Tidak ada data" hint="Endpoint connections kosong." />;

  const { flow, usage, accounts, platforms } = data.data;
  const needsLogin = !flow.reachable || !flow.pageOpen || !flow.promptPresent;

  return (
    <div className="stack">
      <Section title="Browser & Google Flow">
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
          {needsLogin ? (
            <div className="notice">
              Menghubungkan browser dilakukan dari terminal, bukan dari UI:
              <br />
              <code>corepack pnpm --filter @saa/local-api flow:login</code>
              <br />
              lalu buka satu project di Flow agar tab project tersedia.
            </div>
          ) : null}
          {flow.challengeDetected ? (
            <div className="error-box" role="alert">
              Flow menampilkan tantangan verifikasi. Hentikan pekerjaan dan selesaikan manual — tidak ada
              bypass.
            </div>
          ) : null}
        </div>
      </Section>

      <Section title="Akun terhubung">
        {accounts.length === 0 ? (
          <EmptyState
            title="Belum ada akun"
            hint={'Daftarkan akun YouTube: corepack pnpm --filter @saa/local-api pair:youtube --label "<label>"'}
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
            per platform. UI tidak pernah menerima kredensial; pairing tetap lewat CLI.
          </div>
        </div>
      </Section>
    </div>
  );
}
