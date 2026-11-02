import type { Schedule } from '@saa/domain';
import {
  getCampaign,
  getJobByIdempotencyKey,
  hasActiveJobForCampaign,
  insertJobIdempotent,
  listContentByCampaign,
  listPlanContentsAwaitingPublish,
  type DatabaseHandle
} from '@saa/database';
import type { EnqueueContext, EnqueueFn } from './scheduler';

export interface ContentProductionOptions {
  db: DatabaseHandle;
}

/**
 * Produksi konten per slot: satu `PLAN_CONTENT` untuk setiap jadwal due yang
 * pipelinenya kosong. Menahan slot berikutnya selama masih ada perencanaan
 * berjalan atau ada item rencana berjalan yang belum punya job publikasi
 * (kedalaman 1 per rencana, bukan hanya konten terbaru).
 */
export function enqueueDueContentPlan(
  db: DatabaseHandle,
  schedule: Schedule,
  context: EnqueueContext
): string[] {
  const campaign = getCampaign(db.raw, schedule.campaignId);
  if (campaign === null || campaign.status !== 'active') return [];
  if (campaign.platforms.length === 0) return [];

  if (hasActiveJobForCampaign(db.raw, { campaignId: campaign.id, jobType: 'PLAN_CONTENT' })) {
    return [];
  }

  const newest = listContentByCampaign(db.raw, campaign.id)[0];
  // Campaign gambar tidak pernah menerbitkan konten, jadi jangan tunggu antrean PUBLISH.
  if (
    campaign.generationMode === 'video' &&
    newest !== undefined &&
    listPlanContentsAwaitingPublish(db.raw, newest).length > 0
  ) {
    return [];
  }

  const slot = schedule.nextRunAt ?? context.now.toISOString();
  const idempotencyKey = `plan:${schedule.id}:${slot}`;
  if (getJobByIdempotencyKey(db.raw, idempotencyKey) !== null) return [];

  const job = insertJobIdempotent(
    db.raw,
    {
      jobType: 'PLAN_CONTENT',
      idempotencyKey,
      campaignId: campaign.id,
      payload: { campaignId: campaign.id }
    },
    context.now.toISOString()
  );
  return [job.id];
}

export function createContentProductionEnqueuer(options: ContentProductionOptions): EnqueueFn {
  return (schedule, context) => enqueueDueContentPlan(options.db, schedule, context);
}
