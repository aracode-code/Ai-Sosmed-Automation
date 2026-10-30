import { describe, expect, it } from 'vitest';
import {
  checkApprovalBinding,
  hashCaption,
  stableStringify,
  type ApprovalBinding
} from './index';

const BASE: ApprovalBinding = {
  contentId: 'cnt_1',
  contentVersion: 2,
  assetSha256: 'a'.repeat(64),
  captionHash: 'b'.repeat(64),
  accountId: 'acc_yt',
  platform: 'youtube'
};

const APPROVED = { ...BASE, decision: 'approved' as const };

describe('approval binding', () => {
  it('menerima approval yang seluruh elemennya cocok', () => {
    expect(checkApprovalBinding(APPROVED, BASE)).toEqual({ ok: true, mismatches: [] });
  });

  it('menolak approval lama setelah asset checksum berubah', () => {
    const result = checkApprovalBinding(APPROVED, { ...BASE, assetSha256: 'c'.repeat(64) });
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual(['assetSha256']);
  });

  it('menolak approval saat caption berubah', () => {
    const result = checkApprovalBinding(APPROVED, { ...BASE, captionHash: 'd'.repeat(64) });
    expect(result.mismatches).toEqual(['captionHash']);
  });

  it('menolak approval saat versi, akun, atau platform berubah', () => {
    expect(checkApprovalBinding(APPROVED, { ...BASE, contentVersion: 3 }).mismatches).toEqual([
      'contentVersion'
    ]);
    expect(checkApprovalBinding(APPROVED, { ...BASE, accountId: 'acc_tt' }).mismatches).toEqual([
      'accountId'
    ]);
    expect(checkApprovalBinding(APPROVED, { ...BASE, platform: 'tiktok' }).mismatches).toEqual([
      'platform'
    ]);
  });

  it('keputusan rejected tidak pernah berlaku sebagai approval', () => {
    const result = checkApprovalBinding({ ...BASE, decision: 'rejected' }, BASE);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain('decision');
  });

  it('melaporkan seluruh elemen yang berubah sekaligus', () => {
    const result = checkApprovalBinding(APPROVED, {
      ...BASE,
      contentVersion: 9,
      assetSha256: 'e'.repeat(64),
      platform: 'instagram'
    });
    expect(result.mismatches).toEqual(['contentVersion', 'assetSha256', 'platform']);
  });
});

describe('hashCaption', () => {
  it('stabil terhadap urutan properti', () => {
    expect(hashCaption({ title: 'a', caption: 'b' })).toBe(hashCaption({ caption: 'b', title: 'a' }));
  });

  it('berbeda saat isi caption berubah', () => {
    expect(hashCaption({ caption: 'v1' })).not.toBe(hashCaption({ caption: 'v2' }));
  });

  it('menghasilkan sha256 hex 64 karakter', () => {
    expect(hashCaption(null)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('stableStringify mengurutkan key bersarang', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});
