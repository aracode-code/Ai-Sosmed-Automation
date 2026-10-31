import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '@saa/domain';
import type { FlowMediaKind } from './flow-usage';

/**
 * Otomasi studio Flow lewat CDP: isi prompt ProseMirror, kirim, tunggu hasil,
 * unduh lewat menu kartu (Opsi lainnya → Download → Ukuran asli).
 *
 * Label UI dilokalkan (ID/EN) sehingga pencocokan memakai pola, bukan teks tetap.
 * Tidak ada penanganan CAPTCHA/verifikasi — kondisi itu dilempar sebagai
 * SECURITY_CHALLENGE dan pekerjaan berhenti.
 */

const PROMPT_SELECTOR = '[role="textbox"][contenteditable="true"]';
const CHALLENGE_TEXT =
  /verify it'?s you|unusual traffic|not a robot|konfirmasi bahwa anda bukan robot|suspicious activity/i;

interface LocatorLike {
  first(): LocatorLike;
  click(options?: { timeout?: number }): Promise<void>;
  isEnabled(): Promise<boolean>;
}

interface DownloadLike {
  suggestedFilename(): string;
  saveAs(path: string): Promise<void>;
}

interface PageLike {
  locator(selector: string): LocatorLike;
  keyboard: { insertText(text: string): Promise<void> };
  waitForEvent(event: 'download', options?: { timeout?: number }): Promise<DownloadLike>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(expression: string): Promise<T>;
}

export interface FlowGenerateOptions {
  endpoint: string;
  prompt: string;
  kind: FlowMediaKind;
  outputDirectory: string;
  /** Batas tunggu hasil (video bisa beberapa menit). Default 15 menit. */
  renderTimeoutMs?: number;
}

export interface FlowGenerateResult {
  filePath: string;
  suggestedName: string;
  mediaKind: FlowMediaKind;
}

/** Prompt eksplisit memilih model: "video" → Veo, "gambar" → Nano Banana. */
export function promptForKind(prompt: string, kind: FlowMediaKind): string {
  const wantsVideo = /video|klip|clip/i.test(prompt);
  const wantsImage = /gambar|image|foto|photo/i.test(prompt);
  if (kind === 'video' && !wantsVideo) return `Buat video: ${prompt}`;
  if (kind === 'image' && !wantsImage) return `Buat gambar: ${prompt}`;
  return prompt;
}

const MEDIA_PROBE = `(() => {
  const video = document.querySelector('video');
  if (video && video.currentSrc) return video.currentSrc;
  const img = [...document.querySelectorAll('img')].find((el) => /googleusercontent|blob:/.test(el.src) && el.naturalWidth > 200);
  return img ? img.src : null;
})()`;

const OPEN_CARD_MENU = `(() => {
  const media = document.querySelector('video') || [...document.querySelectorAll('img')].find((el) => /googleusercontent|blob:/.test(el.src) && el.naturalWidth > 200);
  if (!media) return 'media-tidak-ada';
  let card = media;
  for (let i = 0; i < 8 && card.parentElement; i++) card = card.parentElement;
  const button = [...card.querySelectorAll('button')].find((el) => /opsi lainnya|more options/i.test(el.getAttribute('aria-label') || ''));
  if (!button) return 'menu-tidak-ada';
  button.click();
  return 'ok';
})()`;

async function assertNoChallenge(page: PageLike): Promise<void> {
  const body = await page.evaluate<string>('document.body.innerText');
  if (CHALLENGE_TEXT.test(body)) {
    throw new AppError(
      'SECURITY_CHALLENGE',
      'Flow menampilkan tantangan verifikasi; pekerjaan dihentikan (tanpa bypass)'
    );
  }
}

export async function generateFlowMedia(options: FlowGenerateOptions): Promise<FlowGenerateResult> {
  const prompt = promptForKind(options.prompt, options.kind);
  mkdirSync(options.outputDirectory, { recursive: true });

  const { chromium } = await import('playwright');
  const browser = await chromium.connectOverCDP(options.endpoint);
  const pages = browser.contexts().flatMap((context) => context.pages());
  const flowPage = pages.find((candidate) => candidate.url().includes('flow.google.com/project/'));
  if (flowPage === undefined) {
    throw new AppError(
      'VALIDATION',
      'tab project Flow tidak ditemukan di browser yang di-attach; buka satu project lalu ulangi'
    );
  }
  const page = flowPage as unknown as PageLike;

  await assertNoChallenge(page);

  const promptBox = page.locator(PROMPT_SELECTOR).first();
  await promptBox.click({ timeout: 15_000 });
  await page.keyboard.insertText(prompt);
  await page.waitForTimeout(1_200);

  const submitLocator = page
    .locator('button[aria-label*="Mulai pembuatan"], button[aria-label*="Start generation"]')
    .first();
  if (!(await submitLocator.isEnabled().catch(() => false))) {
    throw new AppError('UI_CHANGED', 'tombol "Mulai pembuatan" tidak aktif setelah prompt diisi');
  }
  await submitLocator.click({ timeout: 15_000 });

  const deadline = Date.now() + (options.renderTimeoutMs ?? 15 * 60 * 1000);
  let media: string | null = null;
  while (Date.now() < deadline) {
    await page.waitForTimeout(5_000);
    await assertNoChallenge(page);
    media = await page.evaluate<string | null>(MEDIA_PROBE);
    if (media !== null) break;
  }
  if (media === null) {
    throw new AppError('EXTERNAL_5XX', 'hasil tidak muncul sebelum batas waktu render');
  }

  const menuState = await page.evaluate<string>(OPEN_CARD_MENU);
  if (menuState !== 'ok') {
    throw new AppError('UI_CHANGED', `menu kartu hasil tidak dapat dibuka (${menuState})`);
  }
  await page.waitForTimeout(800);

  const downloadMenu = page.locator('[role="menuitem"]:has-text("Download")').first();
  const originalQuality = page.locator('[role="menuitem"]:has-text("Ukuran asli")').first();

  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
  await downloadMenu.click({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await originalQuality.click({ timeout: 15_000 });
  const download = await downloadPromise;

  const suggestedName = download.suggestedFilename();
  const fileName = suggestedName.replace(/[^A-Za-z0-9._-]/g, '_');
  const filePath = join(options.outputDirectory, fileName);
  await download.saveAs(filePath);

  return { filePath, suggestedName, mediaKind: options.kind };
}
