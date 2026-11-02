import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ContentItem, MediaKind } from '@saa/domain';
import {
  appendAudit,
  getCampaign,
  getJob,
  getPlanApproval,
  insertJobIdempotent,
  insertPlanApproval,
  listContentByPlanJob,
  planBindingHashOf,
  setContentApprovalStatus,
  type DatabaseHandle
} from '@saa/database';
import { z } from 'zod';
import { errorEnvelope } from '../errors';

export interface PlanRoutesDeps {
  db: DatabaseHandle;
  now?: () => Date;
}

const idParamsSchema = z.object({ jobId: z.string().min(1) });

const decisionBodySchema = z.object({
  bindingHash: z.string().regex(/^[a-f0-9]{64}$/i, 'harus berupa sha256 hex 64 karakter'),
  decidedBy: z.string().trim().min(1).max(120).default('local-user'),
  reason: z.string().trim().max(500).optional()
});

interface Review {
  jobId: string;
  campaignId: string;
  status: string;
  contents: ContentItem[];
  bindingHash: string;
  approval: ReturnType<typeof getPlanApproval>;
}

/**
 * Bahan tinjauan tahap rencana. `bindingHash` dihitung server dari seluruh item,
 * sehingga UI cukup memantulkannya kembali saat menyetujui.
 */
function loadReview(db: DatabaseHandle, jobId: string): Review | null {
  const job = getJob(db.raw, jobId);
  if (job === null || job.jobType !== 'PLAN_CONTENT' || job.campaignId === null) return null;

  const contents = listContentByPlanJob(db.raw, job.id);
  return {
    jobId: job.id,
    campaignId: job.campaignId,
    status: job.status,
    contents,
    bindingHash: planBindingHashOf(contents),
    approval: getPlanApproval(db.raw, job.id)
  };
}

interface GeneratePayload {
  contentId: string;
  campaignId: string;
  videoPrompt: string;
  aspectRatio: string;
  targets?: unknown[];
}

interface PreparedGeneration {
  payload: GeneratePayload;
  mediaKind: MediaKind;
}

function targetsOfCaption(caption: unknown): unknown[] {
  if (caption === null || typeof caption !== 'object' || Array.isArray(caption)) return [];
  return Object.entries(caption as Record<string, unknown>).map(([platform, value]) => ({
    platform,
    ...(value !== null && typeof value === 'object' ? value : {})
  }));
}

function storedMediaKind(prompt: { mediaKind?: unknown }): MediaKind {
  return prompt.mediaKind === 'image' ? 'image' : 'video';
}

function mediaKindOfContent(content: ContentItem): MediaKind {
  const prompt =
    content.prompt !== null && typeof content.prompt === 'object'
      ? (content.prompt as { mediaKind?: unknown })
      : {};
  return storedMediaKind(prompt);
}

function jobTypeForKind(kind: MediaKind): 'GENERATE_VIDEO' | 'GENERATE_IMAGE' {
  return kind === 'image' ? 'GENERATE_IMAGE' : 'GENERATE_VIDEO';
}

/** Payload produksi dibangun ulang dari prompt + caption yang disimpan handler rencana. */
function generatePayloadOf(content: ContentItem, campaignId: string): PreparedGeneration | null {
  const prompt =
    content.prompt !== null && typeof content.prompt === 'object'
      ? (content.prompt as { videoPrompt?: unknown; aspectRatio?: unknown; mediaKind?: unknown })
      : {};
  if (typeof prompt.videoPrompt !== 'string' || prompt.videoPrompt.trim() === '') return null;

  const targets = targetsOfCaption(content.caption);
  return {
    mediaKind: storedMediaKind(prompt),
    payload: {
      contentId: content.id,
      campaignId,
      videoPrompt: prompt.videoPrompt,
      aspectRatio: typeof prompt.aspectRatio === 'string' ? prompt.aspectRatio : '9:16',
      ...(targets.length === 0 ? {} : { targets })
    }
  };
}

export const planRoutes: FastifyPluginAsync<PlanRoutesDeps> = async (app, deps) => {
  const now = deps.now ?? (() => new Date());

  app.get('/api/v1/plans/:jobId', async (request, reply) => {
    const { jobId } = idParamsSchema.parse(request.params);
    const review = loadReview(deps.db, jobId);
    if (review === null) {
      return reply
        .status(404)
        .send(errorEnvelope('NOT_FOUND', `rencana ${jobId} tidak ditemukan`, String(request.id)));
    }

    const campaign = getCampaign(deps.db.raw, review.campaignId);
    return {
      plan: {
        jobId: review.jobId,
        campaignId: review.campaignId,
        status: review.status
      },
      campaign:
        campaign === null
          ? null
          : {
              id: campaign.id,
              name: campaign.name,
              platforms: campaign.platforms,
              approvalMode: campaign.approvalMode,
              generationMode: campaign.generationMode
            },
      contents: review.contents.map((content) => ({
        id: content.id,
        version: content.version,
        topic: content.topic,
        caption: content.caption,
        approvalStatus: content.approvalStatus,
        mediaKind: mediaKindOfContent(content)
      })),
      bindingHash: review.bindingHash,
      approval: review.approval
    };
  });

  const decide = (decision: 'approved' | 'rejected') => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const { jobId } = idParamsSchema.parse(request.params);
      const body = decisionBodySchema.parse(request.body);
      const requestId = String(request.id);

      const review = loadReview(deps.db, jobId);
      if (review === null) {
        return reply
          .status(404)
          .send(errorEnvelope('NOT_FOUND', `rencana ${jobId} tidak ditemukan`, requestId));
      }
      if (review.status !== 'COMPLETED') {
        return reply
          .status(409)
          .send(
            errorEnvelope(
              'PLAN_NOT_READY',
              `rencana ${jobId} berstatus ${review.status}; keputusan hanya setelah perencanaan selesai`,
              requestId
            )
          );
      }
      if (review.contents.length === 0) {
        return reply
          .status(409)
          .send(errorEnvelope('PLAN_EMPTY', `rencana ${jobId} tidak memuat konten`, requestId));
      }
      if (review.approval !== null) {
        return reply.status(409).send(
          errorEnvelope(
            'PLAN_ALREADY_DECIDED',
            `rencana ${jobId} sudah diputuskan (${review.approval.decision})`,
            requestId,
            [review.approval]
          )
        );
      }
      if (body.bindingHash !== review.bindingHash) {
        return reply
          .status(409)
          .send(
            errorEnvelope(
              'PLAN_MISMATCH',
              'rencana berubah sejak ditampilkan; muat ulang sebelum memutuskan',
              requestId,
              ['bindingHash']
            )
          );
      }

      const payloads = new Map<string, PreparedGeneration>();
      if (decision === 'approved') {
        for (const content of review.contents) {
          const prepared = generatePayloadOf(content, review.campaignId);
          if (prepared === null) {
            return reply.status(409).send(
              errorEnvelope(
                'PLAN_INVALID',
                `konten ${content.id} tidak punya videoPrompt yang dapat digenerate`,
                requestId
              )
            );
          }
          payloads.set(content.id, prepared);
        }
      }

      const decidedAt = now().toISOString();
      const saved = deps.db.raw.transaction(() => {
        const approval = insertPlanApproval(
          deps.db.raw,
          {
            planJobId: review.jobId,
            campaignId: review.campaignId,
            bindingHash: review.bindingHash,
            itemCount: review.contents.length,
            decision,
            decidedBy: body.decidedBy,
            reason: body.reason ?? null
          },
          decidedAt
        );

        for (const content of review.contents) {
          setContentApprovalStatus(deps.db.raw, {
            id: content.id,
            version: content.version,
            status: decision
          });
        }

        const enqueuedJobIds: string[] = [];
        if (decision === 'approved') {
          for (const content of review.contents) {
            const prepared = payloads.get(content.id);
            if (prepared === undefined) continue;
            const job = insertJobIdempotent(
              deps.db.raw,
              {
                jobType: jobTypeForKind(prepared.mediaKind),
                idempotencyKey: `generate:${content.id}`,
                campaignId: review.campaignId,
                contentId: content.id,
                parentJobId: review.jobId,
                payload: prepared.payload
              },
              decidedAt
            );
            enqueuedJobIds.push(job.id);
          }
        }

        appendAudit(
          deps.db.raw,
          {
            actorType: 'user',
            actorId: body.decidedBy,
            action: decision === 'approved' ? 'plan.approve' : 'plan.reject',
            resourceType: 'plan',
            resourceId: review.jobId,
            result: 'success',
            metadata: {
              approvalId: approval.id,
              itemCount: review.contents.length,
              enqueued: enqueuedJobIds.length,
              reason: approval.reason
            }
          },
          decidedAt
        );

        return { approval, enqueuedJobIds };
      }).immediate();

      return reply.status(201).send({
        approval: saved.approval,
        contentIds: review.contents.map((content) => content.id),
        enqueuedJobIds: saved.enqueuedJobIds
      });
    };
  };

  app.post('/api/v1/plans/:jobId/approve', decide('approved'));
  app.post('/api/v1/plans/:jobId/reject', decide('rejected'));
};
