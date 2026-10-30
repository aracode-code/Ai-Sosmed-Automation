import type { Planner } from '@saa/agent-core';
import {
  MockVideoGenerator,
  type MediaProbe,
  type VideoGenerator
} from '@saa/browser-engine';
import type { DatabaseHandle } from '@saa/database';
import {
  createGenerateVideoHandler,
  createPlanContentHandler,
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

  return registry;
}
