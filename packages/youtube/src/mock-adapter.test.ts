import { describe, expect, it } from 'vitest';
import { MockYouTubeAdapter } from './mock-adapter';

const REQUEST = {
  accountId: 'acc_yt',
  assetId: 'med_cnt_1',
  caption: 'Dasar AI dalam 30 detik',
  idempotencyKey: 'publish:job_1'
};

describe('MockYouTubeAdapter', () => {
  it('melaporkan capability dengan penanda mock yang jujur', async () => {
    const adapter = new MockYouTubeAdapter({ now: () => new Date('2026-10-30T00:00:00.000Z') });
    const capabilities = await adapter.capabilities();

    expect(capabilities.platform).toBe('youtube');
    expect(capabilities.adapterVersion).toBe('mock-1');
    expect(capabilities.videoSupported).toBe(true);
    expect(capabilities.supportedAspectRatios).toBeUndefined();
    expect(capabilities.maxUploadBytes).toBeUndefined();
    expect(capabilities.limitations.join(' ')).toContain('tidak ada unggahan nyata');
    expect(capabilities.lastVerifiedAt).toBe('2026-10-30T00:00:00.000Z');
  });

  it('menolak request tanpa caption atau aset', async () => {
    const adapter = new MockYouTubeAdapter();
    await expect(adapter.validate({ ...REQUEST, caption: '   ' })).resolves.toMatchObject({
      ok: false
    });
    const missingAsset = await adapter.validate({ ...REQUEST, assetId: '' });
    expect(missingAsset.issues).toContain('assetId kosong');
    await expect(adapter.validate(REQUEST)).resolves.toEqual({ ok: true, issues: [] });
  });

  it('menghasilkan post id deterministik dan idempoten per idempotency key', async () => {
    const adapter = new MockYouTubeAdapter();
    const first = await adapter.publish(REQUEST);
    const second = await adapter.publish(REQUEST);
    const other = await adapter.publish({ ...REQUEST, idempotencyKey: 'publish:job_2' });

    expect(first.status).toBe('published');
    expect(first.externalPostId).toMatch(/^mock_yt_[0-9a-f]{11}$/);
    expect(first.permalink).toBe(`https://www.youtube.com/watch?v=${first.externalPostId}`);
    expect(second.externalPostId).toBe(first.externalPostId);
    expect(other.externalPostId).not.toBe(first.externalPostId);
  });

  it('getStatus mengembalikan unknown untuk key yang tidak pernah dipublikasikan', async () => {
    const adapter = new MockYouTubeAdapter();
    await expect(adapter.getStatus('publish:tidak-ada')).resolves.toMatchObject({
      status: 'unknown',
      retryable: true
    });
  });

  it('dapat mensimulasikan hasil processing lalu published saat direkonsiliasi', async () => {
    const adapter = new MockYouTubeAdapter({ outcome: 'processing', statusOutcome: 'published' });
    const published = await adapter.publish(REQUEST);
    expect(published.status).toBe('processing');

    const status = await adapter.getStatus(REQUEST.idempotencyKey);
    expect(status.status).toBe('published');
    expect(status.externalPostId).toMatch(/^mock_yt_/);
  });

  it('dapat mensimulasikan kegagalan retryable dan permanen', async () => {
    const retryable = new MockYouTubeAdapter({ outcome: 'failed_retryable' });
    await expect(retryable.publish(REQUEST)).resolves.toMatchObject({
      status: 'failed',
      retryable: true
    });

    const permanent = new MockYouTubeAdapter({ outcome: 'failed_permanent' });
    await expect(permanent.publish(REQUEST)).resolves.toMatchObject({
      status: 'failed',
      retryable: false
    });
  });
});
