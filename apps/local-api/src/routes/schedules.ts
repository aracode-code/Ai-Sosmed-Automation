import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  SCHEDULE_MODES,
  validateScheduleConfig,
  type ScheduleConfig,
  type ScheduleMode
} from '@saa/domain';
import {
  getCampaign,
  getSchedule,
  insertSchedule,
  listSchedules,
  updateSchedule,
  type DatabaseHandle
} from '@saa/database';
import { computeNextRun, setSchedulerPaused } from '@saa/scheduler';
import { z } from 'zod';
import { errorEnvelope } from '../errors';

export interface ScheduleRoutesDeps {
  db: DatabaseHandle;
  now: () => Date;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const modeSchema = z
  .string()
  .refine((value) => (SCHEDULE_MODES as readonly string[]).includes(value), {
    message: 'mode jadwal tidak dikenal'
  })
  .transform((value) => value as ScheduleMode);

const minutes = z.number().int().min(1).nullish();
const timeOfDay = z.string().regex(HHMM, 'harus berformat HH:mm').nullish();
const quietSchema = z
  .object({ start: z.string().regex(HHMM), end: z.string().regex(HHMM) })
  .nullish();

const createScheduleSchema = z.object({
  campaignId: z.string().min(1).max(100),
  mode: modeSchema,
  minMinutes: minutes,
  maxMinutes: minutes,
  windowStart: timeOfDay,
  windowEnd: timeOfDay,
  timezone: z.string().min(1).max(64).optional(),
  dailyLimit: z.number().int().min(1).max(100).optional(),
  quietHours: quietSchema,
  enabled: z.boolean().optional()
});

const patchScheduleSchema = createScheduleSchema.omit({ campaignId: true }).partial();

const idParamsSchema = z.object({ id: z.string().min(1) });

function resolved(config: ScheduleConfig): ScheduleConfig {
  return {
    mode: config.mode,
    minMinutes: config.minMinutes ?? null,
    maxMinutes: config.maxMinutes ?? null,
    windowStart: config.windowStart ?? null,
    windowEnd: config.windowEnd ?? null,
    timezone: config.timezone,
    dailyLimit: config.dailyLimit,
    quietHours: config.quietHours ?? null,
    enabled: config.enabled
  };
}

function scheduleNotFound(reply: FastifyReply, request: FastifyRequest, id: string) {
  return reply
    .status(404)
    .send(errorEnvelope('NOT_FOUND', `jadwal ${id} tidak ditemukan`, String(request.id)));
}

export const scheduleRoutes: FastifyPluginAsync<ScheduleRoutesDeps> = async (app, deps) => {
  app.post('/api/v1/schedules', async (request, reply) => {
    const body = createScheduleSchema.parse(request.body);

    const campaign = getCampaign(deps.db.raw, body.campaignId);
    if (campaign === null) {
      return reply
        .status(404)
        .send(
          errorEnvelope('NOT_FOUND', `campaign ${body.campaignId} tidak ditemukan`, String(request.id))
        );
    }

    const config = resolved({
      mode: body.mode,
      minMinutes: body.minMinutes ?? null,
      maxMinutes: body.maxMinutes ?? null,
      windowStart: body.windowStart ?? null,
      windowEnd: body.windowEnd ?? null,
      timezone: body.timezone ?? 'Asia/Jakarta',
      dailyLimit: body.dailyLimit ?? 1,
      quietHours: body.quietHours ?? null,
      enabled: body.enabled ?? true
    });

    const validation = validateScheduleConfig(config);
    if (!validation.ok) {
      return reply
        .status(400)
        .send(errorEnvelope('VALIDATION_ERROR', 'Jadwal tidak valid', String(request.id), validation.issues));
    }

    const schedule = insertSchedule(deps.db.raw, {
      campaignId: campaign.id,
      ...config,
      nextRunAt: config.enabled ? computeNextRun(config, deps.now()).toISOString() : null
    });

    return reply.status(201).send({ schedule });
  });

  app.get('/api/v1/schedules', async (request) => {
    const query = z
      .object({ campaignId: z.string().min(1).optional() })
      .parse(request.query);
    return { items: listSchedules(deps.db.raw, query) };
  });

  app.patch('/api/v1/schedules/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const patch = patchScheduleSchema.parse(request.body);
    const existing = getSchedule(deps.db.raw, id);
    if (existing === null) return scheduleNotFound(reply, request, id);

    const config = resolved({
      mode: patch.mode ?? existing.mode,
      minMinutes: patch.minMinutes === undefined ? existing.minMinutes : patch.minMinutes,
      maxMinutes: patch.maxMinutes === undefined ? existing.maxMinutes : patch.maxMinutes,
      windowStart: patch.windowStart === undefined ? existing.windowStart : patch.windowStart,
      windowEnd: patch.windowEnd === undefined ? existing.windowEnd : patch.windowEnd,
      timezone: patch.timezone ?? existing.timezone,
      dailyLimit: patch.dailyLimit ?? existing.dailyLimit,
      quietHours: patch.quietHours === undefined ? existing.quietHours : patch.quietHours,
      enabled: patch.enabled ?? existing.enabled
    });

    const validation = validateScheduleConfig(config);
    if (!validation.ok) {
      return reply
        .status(400)
        .send(errorEnvelope('VALIDATION_ERROR', 'Jadwal tidak valid', String(request.id), validation.issues));
    }

    // Jadwal baru berlaku untuk job berikutnya; job yang sudah ada tidak diubah.
    const nextRunAt = config.enabled ? computeNextRun(config, deps.now()).toISOString() : null;
    const schedule = updateSchedule(deps.db.raw, id, { ...config, nextRunAt });
    if (schedule === null) return scheduleNotFound(reply, request, id);

    return { schedule };
  });

  app.post('/api/v1/scheduler/pause', async () => {
    setSchedulerPaused(deps.db, true, deps.now());
    return { paused: true };
  });

  app.post('/api/v1/scheduler/resume', async () => {
    setSchedulerPaused(deps.db, false, deps.now());
    return { paused: false };
  });
};
