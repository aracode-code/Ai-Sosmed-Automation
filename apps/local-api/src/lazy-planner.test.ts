import { describe, expect, it, vi } from 'vitest';
import type { Planner, PlannerResult } from '@saa/agent-core';
import { AppError } from '@saa/domain';
import { createLazyPlanner } from './lazy-planner';

function plannerReturning(label: string): Planner {
  return {
    plan: vi.fn(async () => ({ plan: {} as PlannerResult['plan'], attempts: 1, repaired: false, model: label }))
  };
}

describe('createLazyPlanner', () => {
  it('gagal AUTH tanpa nilai kunci', async () => {
    const planner = createLazyPlanner({
      credentials: { resolve: async () => null },
      create: () => plannerReturning('tidak-dipakai')
    });

    await expect(planner.plan({})).rejects.toMatchObject({
      name: 'AppError',
      errorClass: 'AUTH'
    });
  });

  it('membuat planner saat job pertama berjalan, bukan saat konstruksi', async () => {
    const create = vi.fn(() => plannerReturning('deepseek-chat'));
    const planner = createLazyPlanner({
      credentials: { resolve: async () => ({ apiKey: 'kunci-abcdef', source: 'store' }) },
      create
    });

    expect(create).not.toHaveBeenCalled();
    await planner.plan({});
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('memakai ulang planner selama kunci sama dan membuat ulang saat kunci berubah', async () => {
    let key = 'kunci-pertama-123';
    const create = vi.fn((apiKey: string) => plannerReturning(apiKey));
    const planner = createLazyPlanner({
      credentials: { resolve: async () => ({ apiKey: key, source: 'store' }) },
      create
    });

    await planner.plan({});
    await planner.plan({});
    expect(create).toHaveBeenCalledTimes(1);

    key = 'kunci-kedua-456';
    await planner.plan({});
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenLastCalledWith('kunci-kedua-456');
  });

  it('meneruskan error non-AUTH dari planner tanpa menutupinya', async () => {
    const failure = new AppError('TRANSIENT_NETWORK', 'jaringan putus');
    const planner = createLazyPlanner({
      credentials: { resolve: async () => ({ apiKey: 'kunci-abcdef', source: 'env' }) },
      create: () => ({
        plan: async () => {
          throw failure;
        }
      })
    });

    await expect(planner.plan({})).rejects.toBe(failure);
  });
});
