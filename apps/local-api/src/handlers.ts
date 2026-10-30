import type { Planner } from '@saa/agent-core';
import {
  MockVideoGenerator,
  type MediaProbe,
  type VideoGenerator
} from '@saa/browser-engine';
import type { DatabaseHandle } from '@saa/database';
import type { SocialAdapter } from '@saa/domain';
import {
  createGenerateVideoHandler,
  createPlanContentHandler,
  createPublishHandler,
  type HandlerRegistry
} from '@saa/workflow';

export interface HandlerRegistryOptions {
  db: DatabaseHandle;
  /** Akar penyimpanan media; wajib sama dengan `outputRoot` generator. */
  mediaRoot: string;
  /** Tanpa planner, `PLAN_CONTENT` sengaja tidak terdaftar (bukan fallback diam-diam). */
  planner?: Planner;
  generator?: VideoGenerator;
  probe?: MediaProbe;
  /** Tanpa adapter, `PUBLISH` sengaja tidak terdaftar. */
  publisher?: SocialAdapter;
}

export function buildHandlerRegistry(options: HandlerRegistryOptions): HandlerRegistry {
  const generator =
    options.generator ?? new MockVideoGenerator({ outputRoot: options.mediaRoot });

  const registry: HandlerRegistry = {
    GENERATE_VIDEO: createGenerateVideoHandler({
      db: options.db,
      generator,
      outputRoot: options.mediaRoot,
      ...(options.probe === undefined ? {} : { probe: options.probe })
    })
  };

  if (options.planner !== undefined) {
    registry.PLAN_CONTENT = createPlanContentHandler({
      db: options.db,
      planner: options.planner
    });
  }

  if (options.publisher !== undefined) {
    registry.PUBLISH = createPublishHandler({
      db: options.db,
      adapter: options.publisher
    });
  }

  return registry;
}
