import { useState } from 'react';
import { useApi } from './api';
import type { Health } from './types';
import { JobsPage } from './pages/JobsPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { AccountsPage } from './pages/AccountsPage';

type Tab = 'jobs' | 'campaigns' | 'approvals' | 'accounts';

interface TabDef {
  id: Tab;
  label: string;
  icon: JSX.Element;
}

const TABS: TabDef[] = [
  {
    id: 'jobs',
    label: 'Jobs',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2 4h12M2 8h12M2 12h8" />
      </svg>
    )
  },
  {
    id: 'campaigns',
    label: 'Campaigns',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="2" width="5" height="5" rx="1" />
        <rect x="9" y="2" width="5" height="5" rx="1" />
        <rect x="2" y="9" width="5" height="5" rx="1" />
        <rect x="9" y="9" width="5" height="5" rx="1" />
      </svg>
    )
  },
  {
    id: 'approvals',
    label: 'Approvals',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 8.5l3 3 7-7" />
      </svg>
    )
  },
  {
    id: 'accounts',
    label: 'Accounts',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="5.5" r="2.5" />
        <path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" />
      </svg>
    )
  }
];

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('jobs');
  const [refreshToken, setRefreshToken] = useState(0);
  const health = useApi<Health>(`/health?t=${refreshToken}`);

  const online = health.data !== null && health.data.db === 'ok';
  const active = TABS.find((entry) => entry.id === tab);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">S</span>
          <div>
            <div className="brand-name">SAA</div>
            <div className="brand-sub">Social Automation</div>
          </div>
        </div>

        <nav className="nav">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === tab ? 'nav-item nav-item-active' : 'nav-item'}
              onClick={() => setTab(entry.id)}
            >
              <span className="nav-icon">{entry.icon}</span>
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="health">
            <span className={online ? 'dot dot-ok' : 'dot dot-bad'} />
            {online ? (
              <span>
                API aktif · v{health.data?.version} · worker {health.data?.workers.active}
              </span>
            ) : health.error !== null ? (
              <span>API tidak terjangkau</span>
            ) : (
              <span>Memeriksa API…</span>
            )}
          </div>
          <div className="health-sub">127.0.0.1:4317 · loopback</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>{active?.label ?? ''}</h1>
          <div className="topbar-right">
            <span className="timestamp">
              {health.data === null ? '' : `diperbarui ${new Date(health.data.time).toLocaleTimeString('id-ID')}`}
            </span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setRefreshToken((value) => value + 1)}
            >
              Muat ulang
            </button>
          </div>
        </header>

        <div className="content">
          {tab === 'jobs' ? <JobsPage refreshToken={refreshToken} /> : null}
          {tab === 'campaigns' ? <CampaignsPage refreshToken={refreshToken} /> : null}
          {tab === 'approvals' ? <ApprovalsPage refreshToken={refreshToken} /> : null}
          {tab === 'accounts' ? <AccountsPage refreshToken={refreshToken} /> : null}
        </div>
      </main>
    </div>
  );
}
