# Modul — Agent Core (P2)

**Status:** COMPLETED (2026-10-30) · commit `7d02a06`, perbaikan `9cd360c`
**Sumber:** kode aktual (E1), bukan desain. Keputusan: `decisions/ADR-0002-p2-agent-core.md`.

## Peta Paket

| Berkas | Tanggung jawab |
|---|---|
| `packages/agent-core/src/plan.ts` | Skema input/output planner (`PlannerInput`, `PlanDecision`), 4 jenis keputusan, `checkPlanAgainstCampaign`, `enforceApproval`, `DEFAULT_CAPTION_LIMIT = 2200` |
| `packages/agent-core/src/llm.ts` | Interface transport-agnostic `LlmClient`/`LlmRequest`/`LlmResponse` |
| `packages/agent-core/src/deepseek.ts` | `createDeepSeekClient` berbasis `fetch`: base URL `https://api.deepseek.com`, model default `deepseek-chat`, timeout 60 s, JSON mode, pemetaan HTTP → `ErrorClass` |
| `packages/agent-core/src/prompts.ts` | `SYSTEM_PROMPT` (aturan mengikat), `buildPlannerMessages`, `buildRepairPrompt` |
| `packages/agent-core/src/planner.ts` | `createPlanner` (loop perbaikan terbatas), `PlannerError`, `PlannerOutputError` |
| `packages/agent-core/src/tools.ts` | `defineTool`, `ToolRegistry`, `ToolError`, `DEFAULT_TOOL_LIMITS` |
| `packages/agent-core/src/index.ts` | Re-export publik paket |

Arah dependensi: `@saa/agent-core` → `@saa/domain` + `zod`. Tidak mengimpor database/workflow.

## Perilaku Penting

- **Alur planner:** validasi `PlannerInput` → `complete` (jsonMode, temperature 0.2, maxTokens 1200) → buang code fence → `JSON.parse` → `planDecisionSchema` → `checkPlanAgainstCampaign` → `enforceApproval`.
- **Kegagalan:** input invalid → `PlannerError` (`VALIDATION`, model tidak dipanggil); output invalid/kebijakan dilanggar setelah 1 perbaikan → `PlannerOutputError` (`AI_OUTPUT_INVALID` → retry policy `escalate` → `NEEDS_ATTENTION`).
- **Pemetaan HTTP DeepSeek:** 401/403 → `AUTH`; 429 → `RATE_LIMIT` + `retryAfterMs` dari header; 408/504 → `TRANSIENT_NETWORK`; 5xx, envelope rusak, konten kosong → `EXTERNAL_5XX`; 4xx lain → `VALIDATION`.
- **Rahasia:** key hanya hidup di closure adapter; tidak pernah masuk pesan error, log, atau payload hasil.
- **Tool:** tidak terdaftar → `UNKNOWN_TOOL`; budget habis → `TOOL_BUDGET_EXCEEDED`; input/output gagal Zod → `INVALID_INPUT`/`INVALID_OUTPUT`; lewat 10 s → `TOOL_TIMEOUT` (`TRANSIENT_NETWORK`); abort pemanggil → `TOOL_CANCELLED`. Nama shell/exec/eval/spawn ditolak saat registrasi.

## Perintah

```bash
corepack pnpm --filter @saa/agent-core typecheck
corepack pnpm vitest run packages/agent-core     # 29 test
corepack pnpm test                                # seluruh workspace (179 test per 2026-10-30)
```

## Belum Ada (P2+)

- ~~Wiring planner ke dispatcher (`PLAN_CONTENT`)~~ DONE 2026-10-30 (`826a732`) — lihat `modules/workflow.md`.
- Uji live DeepSeek (butuh keputusan sumber API key).
- Kanal peringatan untuk target dengan capability `unknown` (saat ini hanya `unsupported` yang memblokir).
