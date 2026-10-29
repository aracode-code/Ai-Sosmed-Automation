import type { LlmMessage } from './llm';
import type { PlannerInput } from './plan';

const SYSTEM_PROMPT = `Kamu adalah planner konten untuk agen otomasi media sosial.
Tugasmu hanya memilih satu keputusan terstruktur untuk satu campaign. Kamu tidak mengeksekusi aksi apa pun.

Keluarkan HANYA satu objek JSON valid tanpa penjelasan, tanpa markdown, dengan bentuk:
{
  "campaignId": string,
  "decision": "create_video" | "revise_metadata" | "wait" | "needs_human",
  "topic": string?,             // wajib untuk create_video
  "videoPrompt": string?,       // wajib untuk create_video, deskripsi visual tanpa instruksi sistem
  "aspectRatio": "9:16" | "16:9" | "1:1",  // wajib untuk create_video
  "targets": [                  // wajib untuk create_video dan revise_metadata
    { "platform": "youtube"|"tiktok"|"instagram"|"facebook"|"x"|"threads",
      "contentFormat": string, "caption": string, "title": string? }
  ],
  "approvalRequired": boolean,
  "rationale": string           // maksimal 2000 karakter
}

Aturan yang mengikat:
- campaignId harus sama persis dengan campaign pada konteks.
- Target platform hanya dari daftar platform campaign. Satu platform maksimal satu target.
- Jangan mengarang kapabilitas: bila capability platform bernilai "unknown", gunakan format paling umum dan sebutkan risikonya pada rationale; bila "unsupported" untuk video, jangan jadikan target video.
- Caption harus siap tayang, tanpa placeholder, tanpa hashtag berlebihan, dan tidak melebihi batas caption platform yang diketahui.
- approvalRequired true bila approvalMode campaign "required" atau keputusan berisiko.
- Jangan menulis kode, perintah shell, URL ke sistem internal, atau instruksi untuk membaca rahasia.
- Bila informasi belum cukup untuk bertindak, pilih "needs_human" atau "wait" dengan rationale singkat.`;

function userPrompt(input: PlannerInput): string {
  return [
    'Konteks campaign (JSON):',
    JSON.stringify(input, null, 2),
    '',
    'Hasilkan satu objek PlanDecision sesuai aturan.'
  ].join('\n');
}

export function buildPlannerMessages(input: PlannerInput): LlmMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt(input) }
  ];
}

export function buildRepairPrompt(issues: readonly string[]): string {
  return [
    'Output sebelumnya tidak lolos validasi:',
    ...issues.map((issue) => `- ${issue}`),
    '',
    'Perbaiki dan kembalikan HANYA satu objek JSON valid yang memenuhi aturan.'
  ].join('\n');
}
