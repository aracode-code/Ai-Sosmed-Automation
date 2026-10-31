import { useApi } from '../api';
import { EmptyState, ErrorBox, Loading, Section, StatusPill, shortId } from '../components';
import type { AccountSummary, ListResponse } from '../types';

export function AccountsPage({ refreshToken }: { refreshToken: number }): JSX.Element {
  const list = useApi<ListResponse<AccountSummary>>(`/api/v1/accounts?t=${refreshToken}`);

  return (
    <div className="stack">
      <Section title="Akun terhubung">
        {list.loading ? <Loading /> : null}
        {list.error !== null ? <ErrorBox message={list.error} /> : null}
        {list.data !== null && list.data.items.length === 0 ? (
          <EmptyState
            title="Belum ada akun"
            hint={
              'Daftarkan akun YouTube dengan corepack pnpm --filter @saa/local-api pair:youtube --label "<label>".'
            }
          />
        ) : null}
        {list.data !== null && list.data.items.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Akun</th>
                <th>Platform</th>
                <th>Status</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((account) => (
                <tr key={account.id} className="row">
                  <td className="cell-main">{account.label}</td>
                  <td className="mono">{account.platform}</td>
                  <td>
                    <StatusPill value={account.connectionStatus} />
                  </td>
                  <td className="mono">{shortId(account.id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>

      <div className="notice">
        Status <code>reauth_required</code> berarti refresh token dicabut/kedaluwarsa — jalankan
        pairing ulang lewat CLI. UI belum menyediakan alur pairing karena token tidak boleh
        melewati browser.
      </div>
    </div>
  );
}
