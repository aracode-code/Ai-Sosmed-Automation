import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { hashCaption, PLATFORM_IDS, type PlatformId } from '@saa/domain';
import {
  appendAudit,
  getContentItem,
  getSocialAccount,
  insertApproval,
  listMediaByContent,
  setContentApprovalStatus,
  type DatabaseHandle
} from '@saa/database';
import { z } from 'zod';
import { errorEnvelope } from '../errors';

export interface ApprovalRoutesDeps {
  db: DatabaseHandle;
}

const platformSchema = z
  .string()
  .refine((value) => (PLATFORM_IDS as readonly string[]).includes(value), {
    message: 'platform tidak dikenal'
  })
  .transform((value) => value as PlatformId);

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, 'harus berupa sha256 hex 64 karakter');

const decisionBodySchema = z.object({
  version: z.number().int().min(1),
  assetSha256: sha256,
  captionHash: sha256,
  accountId: z.string().min(1).max(100),
  platform: platformSchema,
  decidedBy: z.string().trim().min(1).max(120).default('local-user'),
  reason: z.string().trim().max(500).optional()
});

const idParamsSchema = z.object({ id: z.string().min(1) });

function notFound(reply: FastifyReply, request: FastifyRequest, what: string, id: string) {
  return reply
    .status(404)
    .send(errorEnvelope('NOT_FOUND', `${what} ${id} tidak ditemukan`, String(request.id)));
}

export const approvalRoutes: FastifyPluginAsync<ApprovalRoutesDeps> = async (app, deps) => {
  const decide = (decision: 'approved' | 'rejected') => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamsSchema.parse(request.params);
      const body = decisionBodySchema.parse(request.body);

      const content = getContentItem(deps.db.raw, id, body.version);
      if (content === null) return notFound(reply, request, 'konten', `${id} v${body.version}`);

      const account = getSocialAccount(deps.db.raw, body.accountId);
      if (account === null) return notFound(reply, request, 'akun', body.accountId);

      if (account.platform !== body.platform) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              'PLATFORM_MISMATCH',
              `akun ${account.id} terdaftar sebagai ${account.platform}`,
              String(request.id)
            )
          );
      }

      // Approval harus merujuk caption dan aset yang benar-benar terlihat reviewer.
      const mismatches: string[] = [];
      if (hashCaption(content.caption) !== body.captionHash) mismatches.push('captionHash');
      const assets = listMediaByContent(deps.db.raw, content.id);
      if (assets.length > 0 && !assets.some((asset) => asset.sha256 === body.assetSha256)) {
        mismatches.push('assetSha256');
      }
      if (mismatches.length > 0) {
        return reply
          .status(409)
          .send(
            errorEnvelope(
              'APPROVAL_MISMATCH',
              'konten berubah sejak ditampilkan; muat ulang sebelum menyetujui',
              String(request.id),
              mismatches
            )
          );
      }

      const approval = insertApproval(deps.db.raw, {
        contentId: content.id,
        contentVersion: content.version,
        assetSha256: body.assetSha256,
        captionHash: body.captionHash,
        accountId: account.id,
        platform: body.platform,
        decision,
        decidedBy: body.decidedBy,
        reason: body.reason ?? null
      });

      setContentApprovalStatus(deps.db.raw, {
        id: content.id,
        version: content.version,
        status: decision
      });

      appendAudit(deps.db.raw, {
        actorType: 'user',
        actorId: body.decidedBy,
        action: decision === 'approved' ? 'content.approve' : 'content.reject',
        resourceType: 'content_item',
        resourceId: `${content.id}@${content.version}`,
        result: 'success',
        metadata: {
          approvalId: approval.id,
          accountId: account.id,
          platform: body.platform,
          reason: approval.reason
        }
      });

      return reply.status(201).send({ approval });
    };
  };

  app.post('/api/v1/content/:id/approve', decide('approved'));
  app.post('/api/v1/content/:id/reject', decide('rejected'));
};
