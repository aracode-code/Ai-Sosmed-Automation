import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, ToolError, ToolRegistry } from './index';

const echoTool = defineTool({
  name: 'get_job_status',
  description: 'Baca status job (read-only)',
  inputSchema: z.object({ jobId: z.string().min(1) }),
  outputSchema: z.object({ jobId: z.string(), status: z.string() }),
  handler: (input) => ({ jobId: input.jobId, status: 'QUEUED' })
});

describe('ToolRegistry', () => {
  it('mendaftarkan tool dan menampilkan allowlist terurut', () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);

    expect(registry.has('get_job_status')).toBe(true);
    expect(registry.names()).toEqual(['get_job_status']);
    expect(registry.has('shell')).toBe(false);
  });

  it('menolak nama tidak valid, tool terlarang, dan duplikat', () => {
    const registry = new ToolRegistry();

    expect(() => registry.register({ ...echoTool, name: 'Bad-Name' })).toThrow(ToolError);
    expect(() => registry.register({ ...echoTool, name: 'bash' })).toThrow(/dilarang/);
    registry.register(echoTool);
    expect(() => registry.register({ ...echoTool, name: 'get_job_status' })).toThrow(/sudah terdaftar/);
  });

  it('menolak tool yang tidak terdaftar', async () => {
    const registry = new ToolRegistry();
    await expect(registry.invoke('shell', { command: 'rm -rf /' })).rejects.toMatchObject({
      code: 'UNKNOWN_TOOL'
    });
  });

  it('memvalidasi input dan output dengan Zod', async () => {
    const registry = new ToolRegistry().register(echoTool);

    await expect(registry.invoke('get_job_status', { jobId: '' })).rejects.toMatchObject({
      code: 'INVALID_INPUT'
    });

    registry.register({
      ...echoTool,
      name: 'broken_output',
      handler: () => ({ jobId: 'job_1', status: 42 })
    });
    await expect(registry.invoke('broken_output', { jobId: 'job_1' })).rejects.toMatchObject({
      code: 'INVALID_OUTPUT'
    });
  });

  it('menegakkan batas jumlah panggilan per run', async () => {
    const registry = new ToolRegistry({ maxCalls: 1 }).register(echoTool);

    await expect(registry.invoke('get_job_status', { jobId: 'job_1' })).resolves.toEqual({
      jobId: 'job_1',
      status: 'QUEUED'
    });
    await expect(registry.invoke('get_job_status', { jobId: 'job_2' })).rejects.toMatchObject({
      code: 'TOOL_BUDGET_EXCEEDED'
    });
    expect(registry.callCount).toBe(1);
  });

  it('menghentikan tool yang melewati timeout', async () => {
    const registry = new ToolRegistry({ timeoutMs: 10 }).register(
      defineTool({
        name: 'lambat',
        description: 'tool lambat untuk uji timeout',
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { ok: true };
        }
      })
    );

    const error = await registry.invoke('lambat', {}).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'TOOL_TIMEOUT', errorClass: 'TRANSIENT_NETWORK' });
  });

  it('memetakan pembatalan pemanggil ke TOOL_CANCELLED', async () => {
    const controller = new AbortController();
    controller.abort();
    const registry = new ToolRegistry().register(
      defineTool({
        name: 'dibatalkan',
        description: 'tool yang langsung gagal setelah abort',
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        handler: () => {
          throw new Error('dibatalkan pemanggil');
        }
      })
    );

    await expect(
      registry.invoke('dibatalkan', {}, { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'TOOL_CANCELLED', errorClass: 'CANCELLED' });
  });
});
