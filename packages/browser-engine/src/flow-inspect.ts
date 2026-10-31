import { AppError } from '@saa/domain';
import type { FlowPage } from './flow-session';

/**
 * Pemetaan UI Flow dari sesi nyata. Dipakai sebelum menulis adapter agar
 * selektor berasal dari halaman aktual, bukan tebakan (ADR-0010 F6).
 *
 * Kolektor dikirim sebagai ekspresi string (bukan fungsi bertipe DOM) supaya
 * paket ini tidak perlu memaksa `lib DOM` pada semua konsumen.
 */

export interface PageElement {
  tag: string;
  text?: string;
  ariaLabel?: string;
  testId?: string;
  placeholder?: string;
  type?: string;
  contentEditable?: boolean;
}

export interface PageOutline {
  url: string;
  title: string;
  /** Indikasi halaman login/verifikasi — adapter harus berhenti, bukan menebak. */
  looksLikeSignIn: boolean;
  inputs: PageElement[];
  buttons: PageElement[];
  headings: string[];
}

const COLLECT_EXPRESSION = `(() => {
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const describe = (el) => {
    const out = { tag: el.tagName.toLowerCase() };
    const text = (el.textContent || '').trim();
    const ariaLabel = el.getAttribute('aria-label');
    const testId = el.getAttribute('data-testid');
    const placeholder = el.getAttribute('placeholder');
    const type = el.getAttribute('type');
    if (text) out.text = text.slice(0, 120);
    if (ariaLabel) out.ariaLabel = ariaLabel.slice(0, 120);
    if (testId) out.testId = testId;
    if (placeholder) out.placeholder = placeholder.slice(0, 120);
    if (type) out.type = type;
    if (el.isContentEditable) out.contentEditable = true;
    return out;
  };
  const collect = (selector, limit) =>
    Array.from(document.querySelectorAll(selector)).filter(isVisible).slice(0, limit).map(describe);
  const inputs = collect('input, textarea, [contenteditable="true"]', 40);
  const buttons = collect('button, [role="button"]', 60);
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .filter(isVisible)
    .slice(0, 20)
    .map((el) => (el.textContent || '').trim())
    .filter((text) => text !== '');
  const bodyText = (document.body.innerText || '').toLowerCase();
  const looksLikeSignIn =
    /sign in|masuk|use your google account|choose an account|verify it'?s you|not be secure/.test(bodyText) &&
    inputs.length <= 4;
  return {
    url: window.location.href,
    title: document.title,
    looksLikeSignIn,
    inputs,
    buttons,
    headings
  };
})()`;

export async function collectPageOutline(
  page: FlowPage,
  options: { waitMs?: number } = {}
): Promise<PageOutline> {
  if (page.evaluate === undefined) {
    throw new AppError('UNKNOWN', 'halaman tidak mendukung evaluate untuk pemetaan DOM');
  }
  await page.waitForTimeout?.(options.waitMs ?? 5_000);
  return page.evaluate<PageOutline>(COLLECT_EXPRESSION);
}
