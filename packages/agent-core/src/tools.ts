import { AppError, type ErrorClass } from '@saa/domain';
import { z, type ZodTypeAny } from 'zod';

export interface ToolLogger {
  info(payload: unknown, message?: string): void;
  warn(payload: unknown, message?: string): void;
}

/**
 * Konteks tool sengaja tidak memuat API key, cookie, atau profil browser
 * (LLD §9.3): tool hanya menerima data yang dibutuhkan untuk tugasnya.
 */
export interface ToolContext {
  signal?: AbortSignal;
  logger?: ToolLogger;
}

export type ToolHandler<I extends ZodTypeAny, O extends ZodTypeAny> = (
  input: z.infer<I>,
  ctx: ToolContext
) => Promise<z.infer<O>> | z.infer<O>;

export interface TypedToolDefinition<I extends ZodTypeAny, O extends ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  handler: ToolHandler<I, O>;
}

/** Bentuk yang disimpan registry: tipe input/output sudah dihapus (aman untuk Map). */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  outputSchema: ZodTypeAny;
  handler: (input: unknown, ctx: ToolContext) => Promise<unknown> | unknown;
}

export function defineTool<I extends ZodTypeAny, O extends ZodTypeAny>(
  definition: TypedToolDefinition<I, O>
): ToolDefinition {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    handler: async (input, ctx) => definition.handler(input as z.infer<I>, ctx)
  };
}

export type ToolErrorCode =
  | 'UNKNOWN_TOOL'
  | 'FORBIDDEN_TOOL'
  | 'DUPLICATE_TOOL'
  | 'INVALID_TOOL_NAME'
  | 'INVALID_INPUT'
  | 'INVALID_OUTPUT'
  | 'TOOL_BUDGET_EXCEEDED'
  | 'TOOL_TIMEOUT'
  | 'TOOL_CANCELLED';

const ERROR_CLASS_BY_CODE: Record<ToolErrorCode, ErrorClass> = {
  UNKNOWN_TOOL: 'VALIDATION',
  FORBIDDEN_TOOL: 'VALIDATION',
  DUPLICATE_TOOL: 'VALIDATION',
  INVALID_TOOL_NAME: 'VALIDATION',
  INVALID_INPUT: 'VALIDATION',
  INVALID_OUTPUT: 'VALIDATION',
  TOOL_BUDGET_EXCEEDED: 'VALIDATION',
  TOOL_TIMEOUT: 'TRANSIENT_NETWORK',
  TOOL_CANCELLED: 'CANCELLED'
};

export class ToolError extends AppError {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly details: string[] = []
  ) {
    super(ERROR_CLASS_BY_CODE[code], message);
    this.name = 'ToolError';
  }
}

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

/** Tool yang memberi akses shell/eval dilarang masuk allowlist (LLD §9.3). */
const FORBIDDEN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'shell',
  'exec',
  'execute',
  'bash',
  'run_shell',
  'run_command',
  'spawn',
  'eval'
]);

export interface ToolLimits {
  maxCalls: number;
  timeoutMs: number;
}

export const DEFAULT_TOOL_LIMITS: ToolLimits = { maxCalls: 8, timeoutMs: 10_000 };

function issuesOf(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

class ToolTimeout extends Error {
  constructor() {
    super('tool timeout');
    this.name = 'ToolTimeout';
  }
}

/**
 * Registry allowlist per run. Tool yang tidak terdaftar tidak dapat dipanggil;
 * jumlah panggilan dibatasi agar model tidak masuk loop tanpa batas.
 */
export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition>();
  readonly #limits: ToolLimits;
  #calls = 0;

  constructor(limits: Partial<ToolLimits> = {}) {
    this.#limits = { ...DEFAULT_TOOL_LIMITS, ...limits };
    if (this.#limits.maxCalls < 1) {
      throw new ToolError('INVALID_TOOL_NAME', 'maxCalls minimal 1');
    }
    if (this.#limits.timeoutMs < 1) {
      throw new ToolError('INVALID_TOOL_NAME', 'timeoutMs minimal 1');
    }
  }

  get limits(): ToolLimits {
    return this.#limits;
  }

  get callCount(): number {
    return this.#calls;
  }

  register(definition: ToolDefinition): this {
    if (!TOOL_NAME_PATTERN.test(definition.name)) {
      throw new ToolError('INVALID_TOOL_NAME', `nama tool tidak valid: ${definition.name}`);
    }
    if (FORBIDDEN_TOOL_NAMES.has(definition.name)) {
      throw new ToolError('FORBIDDEN_TOOL', `tool ${definition.name} dilarang di allowlist`);
    }
    if (this.#tools.has(definition.name)) {
      throw new ToolError('DUPLICATE_TOOL', `tool ${definition.name} sudah terdaftar`);
    }
    this.#tools.set(definition.name, definition);
    return this;
  }

  has(name: string): boolean {
    return this.#tools.has(name);
  }

  names(): string[] {
    return [...this.#tools.keys()].sort();
  }

  async invoke<T = unknown>(name: string, rawInput: unknown, ctx: ToolContext = {}): Promise<T> {
    const definition = this.#tools.get(name);
    if (definition === undefined) {
      throw new ToolError('UNKNOWN_TOOL', `tool ${name} tidak terdaftar di allowlist`);
    }
    if (this.#calls >= this.#limits.maxCalls) {
      throw new ToolError(
        'TOOL_BUDGET_EXCEEDED',
        `batas ${this.#limits.maxCalls} pemanggilan tool terlampaui`
      );
    }
    this.#calls += 1;

    const parsed = definition.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ToolError('INVALID_INPUT', `input tool ${name} tidak valid`, issuesOf(parsed.error));
    }

    const timeoutSignal = AbortSignal.timeout(this.#limits.timeoutMs);
    const signal =
      ctx.signal === undefined ? timeoutSignal : AbortSignal.any([ctx.signal, timeoutSignal]);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ToolTimeout()), this.#limits.timeoutMs);
      });

      const output = await Promise.race([
        Promise.resolve().then(() => definition.handler(parsed.data, { ...ctx, signal })),
        timeout
      ]);

      const validated = definition.outputSchema.safeParse(output);
      if (!validated.success) {
        throw new ToolError(
          'INVALID_OUTPUT',
          `output tool ${name} tidak valid`,
          issuesOf(validated.error)
        );
      }

      return validated.data as T;
    } catch (error) {
      if (error instanceof ToolTimeout) {
        throw new ToolError(
          'TOOL_TIMEOUT',
          `tool ${name} timeout setelah ${this.#limits.timeoutMs}ms`
        );
      }
      if (ctx.signal?.aborted === true) {
        throw new ToolError('TOOL_CANCELLED', `tool ${name} dibatalkan`);
      }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
