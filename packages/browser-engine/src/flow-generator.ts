import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppError, type AspectRatio } from '@saa/domain';
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
  waitFor(options?: { state?: 'visible' | 'attached'; timeout?: number }): Promise<void>;
}

interface DownloadLike {
  suggestedFilename(): string;
  saveAs(path: string): Promise<void>;
}

interface PageLike {
  locator(selector: string): LocatorLike;
  keyboard: { insertText(text: string): Promise<void>; press(key: string): Promise<void> };
  waitForEvent(event: 'download', options?: { timeout?: number }): Promise<DownloadLike>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(expression: string): Promise<T>;
}

export interface FlowGenerateOptions {
  endpoint: string;
  prompt: string;
  kind: FlowMediaKind;
  outputDirectory: string;
  /** Rasio yang diminta (policy platform); bila tidak ada, memakai default Flow. */
  aspectRatio?: '9:16' | '16:9' | '1:1';
  /** Batas tunggu hasil (video bisa beberapa menit). Default 15 menit. */
  renderTimeoutMs?: number;
  /** Dipanggil tepat setelah tombol kirim berhasil ditekan (kredit mulai terpakai). */
  onSubmit?: () => Promise<void> | void;
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
  const isMedia = (src) => typeof src === 'string' && (src.includes('/asb/') || src.includes('googleusercontent') || src.includes('storage.googleapis'));
  const video = document.querySelector('video');
  if (video && video.currentSrc) return video.currentSrc;
  const img = [...document.querySelectorAll('img')].find((el) => el.naturalWidth > 200 && isMedia(el.src));
  return img ? img.src : null;
})()`;

const OPEN_CARD_MENU = `(() => {
  const isMedia = (src) => typeof src === 'string' && (src.includes('/asb/') || src.includes('googleusercontent') || src.includes('storage.googleapis'));
  const media = document.querySelector('video') || [...document.querySelectorAll('img')].find((el) => el.naturalWidth > 200 && isMedia(el.src));
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

export type FlowAspectRatio = AspectRatio;

const RATIO_MODEL_PATTERN: Record<FlowMediaKind, string> = {
  image: 'model default pembuatan gambar',
  video: 'model default pembuatan video'
};

/**
 * Ekspresi pemilihan rasio. Cakupan section dicari **berdasarkan kontrak**
 * (satu tombol model + ada radio), bukan jumlah level tetap: depth 1–2 sudah
 * memisahkan gambar/video, depth 3+ menyatukan keduanya. `Simpan` dicari global
 * karena berada di footer panel, di luar section model.
 */
export function buildSetRatioExpression(kind: FlowMediaKind, ratio: FlowAspectRatio): string {
  return `(() => {
    const tune = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').trim() === 'tune');
    if (!tune) return 'panel-tidak-ada';
    tune.click();
    const model = [...document.querySelectorAll('button')].find((el) => /${RATIO_MODEL_PATTERN[kind]}/i.test(el.getAttribute('aria-label') || ''));
    if (!model) return 'model-tidak-ada';
    let scope = model;
    let radios = [];
    for (let depth = 0; depth < 3 && scope.parentElement; depth++) {
      scope = scope.parentElement;
      const owners = [...scope.querySelectorAll('button')].filter((el) => /model default pembuatan/i.test(el.getAttribute('aria-label') || '')).length;
      const found = [...scope.querySelectorAll('[role="radio"]')];
      if (owners === 1 && found.length > 0) { radios = found; break; }
    }
    if (radios.length === 0) return 'scope-tidak-ditemukan';
    const radio = radios.find((el) => (el.textContent || '').includes(${JSON.stringify(ratio)}));
    if (!radio) return 'rasio-tidak-ada';
    radio.click();
    const save = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').trim() === 'Simpan');
    if (!save) return 'simpan-tidak-ada';
    save.click();
    return 'ok';
  })()`;
}

/** Membuka panel lagi dan memastikan radio yang diminta benar-benar aktif. */
export function buildVerifyRatioExpression(kind: FlowMediaKind, ratio: FlowAspectRatio): string {
  return `(() => {
    const tune = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').trim() === 'tune');
    if (!tune) return 'panel-tidak-ada';
    tune.click();
    const model = [...document.querySelectorAll('button')].find((el) => /${RATIO_MODEL_PATTERN[kind]}/i.test(el.getAttribute('aria-label') || ''));
    if (!model) return 'model-tidak-ada';
    let scope = model;
    let radios = [];
    for (let depth = 0; depth < 3 && scope.parentElement; depth++) {
      scope = scope.parentElement;
      const owners = [...scope.querySelectorAll('button')].filter((el) => /model default pembuatan/i.test(el.getAttribute('aria-label') || '')).length;
      const found = [...scope.querySelectorAll('[role="radio"]')];
      if (owners === 1 && found.length > 0) { radios = found; break; }
    }
    if (radios.length === 0) return 'scope-tidak-ditemukan';
    const radio = radios.find((el) => (el.textContent || '').includes(${JSON.stringify(ratio)}));
    if (!radio) return 'rasio-tidak-ada';
    return radio.getAttribute('aria-checked') === 'true' ? 'ok' : 'rasio-belum-aktif';
  })()`;
}

/** Bagian halaman yang dibutuhkan untuk menerapkan rasio (mudah difake di test). */
export interface RatioPage {
  evaluate<T>(expression: string): Promise<T>;
  keyboard: { press(key: string): Promise<void> };
  waitForTimeout(ms: number): Promise<void>;
}

/** Panel Setelan dianggap terbuka bila tombol `Simpan` masih ada di DOM. */
export const PANEL_OPEN_EXPRESSION = `(() => [...document.querySelectorAll('button')].some((el) => (el.textContent || '').trim() === 'Simpan'))()`;

/**
 * Menutup panel hanya bila benar-benar terbuka. `Escape` tidak ditekan refleks
 * karena dapat menutup konteks lain (mis. panel sesi).
 */
async function closeSettingsPanelIfOpen(page: RatioPage): Promise<boolean> {
  const open = await page.evaluate<boolean>(PANEL_OPEN_EXPRESSION);
  if (open) await page.keyboard.press('Escape').catch(() => undefined);
  return open;
}

export async function applyAspectRatio(
  page: RatioPage,
  kind: FlowMediaKind,
  ratio: FlowAspectRatio
): Promise<void> {
  const setState = await page.evaluate<string>(buildSetRatioExpression(kind, ratio));
  await page.waitForTimeout(800);
  if (setState !== 'ok') {
    await closeSettingsPanelIfOpen(page);
    throw new AppError('UI_CHANGED', `rasio ${ratio} tidak dapat diterapkan (${setState})`);
  }

  const verifyState = await page.evaluate<string>(buildVerifyRatioExpression(kind, ratio));
  await page.waitForTimeout(400);
  await closeSettingsPanelIfOpen(page);
  if (verifyState !== 'ok') {
    throw new AppError('UI_CHANGED', `verifikasi rasio ${ratio} gagal (${verifyState})`);
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

  // Panel Setelan yang terbuka menutupi komposer; tutup lalu pilih tab mode.
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(400);
  await page.evaluate<string>(
    `(() => {
      const re = ${options.kind === 'video' ? '/video/i' : '/gambar|image/i'};
      const tab = [...document.querySelectorAll('button')].find((el) => {
        const text = (el.textContent || '').trim();
        return text.length < 20 && re.test(text) && !(el.getAttribute('aria-label') || '').includes('Model');
      });
      if (!tab) return 'tab-tidak-ada';
      tab.click();
      return 'ok';
    })()`
  );
  await page.waitForTimeout(800);
  if (options.aspectRatio !== undefined) {
    await applyAspectRatio(page, options.kind, options.aspectRatio);
  }

  const promptBox = page.locator(PROMPT_SELECTOR).first();
  try {
    await promptBox.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    throw new AppError(
      'UI_CHANGED',
      'kotak prompt tidak terlihat; tutup panel/overlay lalu pastikan tab Gambar/Video aktif'
    );
  }
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
  await options.onSubmit?.();

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
