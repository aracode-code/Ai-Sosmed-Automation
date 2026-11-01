import { describe, expect, it } from 'vitest';
import {
  appendUsage,
  countUsageOn,
  decideGeneration,
  emptyLedger,
  parseFlowGuard,
  parseLedger,
  updateLastStatus,
  type UsageEntry
} from './flow-usage';

const NOW = '2026-11-01T10:00:00.000Z';

function entry(overrides: Partial<UsageEntry> = {}): UsageEntry {
  return {
    at: NOW,
    kind: 'image',
    promptHash: 'hash',
    status: 'succeeded',
    dryRun: false,
    submitted: true,
    ...overrides
  };
}

describe('parseFlowGuard', () => {
  it('memakai default konservatif', () => {
    expect(parseFlowGuard({})).toEqual({ maxPerDay: 1, requireConfirm: true, dryRun: false });
  });

  it('membaca nilai eksplisit', () => {
    expect(
      parseFlowGuard({
        FLOW_MAX_GENERATIONS_PER_DAY: '3',
        FLOW_REQUIRE_CONFIRM: 'false',
        FLOW_DRY_RUN: 'true'
      })
    ).toEqual({ maxPerDay: 3, requireConfirm: false, dryRun: true });
  });

  it('menolak batas tidak valid', () => {
    expect(() => parseFlowGuard({ FLOW_MAX_GENERATIONS_PER_DAY: 'abc' })).toThrow(/tidak valid/);
    expect(() => parseFlowGuard({ FLOW_MAX_GENERATIONS_PER_DAY: '-1' })).toThrow(/tidak valid/);
  });
});

describe('countUsageOn', () => {
  it('menghitung entri pada hari kalender Asia/Jakarta, mengabaikan dry-run', () => {
    const ledger = {
      entries: [
        entry({ at: '2026-11-01T03:00:00.000Z' }), // 10.00 WIB — hari sama
        entry({ at: '2026-11-01T16:59:00.000Z' }), // 23.59 WIB — hari sama
        entry({ at: '2026-11-01T17:00:00.000Z' }), // 00.00 WIB besok — tidak dihitung
        entry({ at: '2026-10-31T23:00:00.000Z' }), // 06.00 WIB 1 Nov — dihitung
        entry({ dryRun: true }),
        entry({ submitted: false }) // gagal sebelum submit — tidak dihitung
      ]
    };
    expect(countUsageOn(ledger, NOW)).toBe(3);
  });
});

describe('decideGeneration', () => {
  it('mengizinkan selama batas belum tercapai', () => {
    const decision = decideGeneration(
      { maxPerDay: 2, requireConfirm: true, dryRun: false },
      { entries: [entry()] },
      NOW
    );
    expect(decision).toEqual({ allowed: true, usedToday: 1 });
  });

  it('menolak saat batas tercapai', () => {
    const decision = decideGeneration(
      { maxPerDay: 1, requireConfirm: true, dryRun: false },
      { entries: [entry()] },
      NOW
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('batas harian');
  });

  it('menolak saat pembuatan dinonaktifkan', () => {
    const decision = decideGeneration(
      { maxPerDay: 0, requireConfirm: true, dryRun: false },
      emptyLedger(),
      NOW
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('dinonaktifkan');
  });
});

describe('parseLedger', () => {
  it('mengembalikan ledger kosong untuk isi rusak atau null', () => {
    expect(parseLedger({ raw: null })).toEqual({ entries: [] });
    expect(parseLedger({ raw: 'bukan json' })).toEqual({ entries: [] });
    expect(parseLedger({ raw: '{"entries":"x"}' })).toEqual({ entries: [] });
  });

  it('menyaring entri yang tidak valid', () => {
    const raw = JSON.stringify({
      entries: [
        entry(),
        { at: 'x' },
        { at: NOW, kind: 'audio', promptHash: 'h', status: 'succeeded', dryRun: false },
        { at: NOW, kind: 'image', promptHash: 'h', status: 'succeeded', dryRun: false }
      ]
    });
    expect(parseLedger({ raw }).entries).toHaveLength(1);
  });
});

describe('append & update', () => {
  it('menambah entri lalu memperbarui status terakhir', () => {
    const started = appendUsage(emptyLedger(), entry({ status: 'started' }));
    const done = updateLastStatus(started, 'succeeded');
    expect(done.entries).toHaveLength(1);
    expect(done.entries[0]?.status).toBe('succeeded');
  });

  it('update pada ledger kosong tidak mengubah apa pun', () => {
    expect(updateLastStatus(emptyLedger(), 'failed')).toEqual({ entries: [] });
  });
});
