import { AppError } from '@saa/domain';

/** Pemeriksaan kesiapan studio Flow tanpa mengubah apa pun (read-only). */

const PROMPT_SELECTOR = '[role="textbox"][contenteditable="true"]';
const CHALLENGE_TEXT =
  /verify it'?s you|unusual traffic|not a robot|konfirmasi bahwa anda bukan robot|suspicious activity/i;

export interface FlowReadiness {
  url: string;
  title: string;
  promptPresent: boolean;
  submitPresent: boolean;
  challengeDetected: boolean;
}

export async function inspectFlowReady(endpoint: string): Promise<FlowReadiness> {
  const { chromium } = await import('playwright');
  const browser = await chromium.connectOverCDP(endpoint);
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url().includes('flow.google.com/'));
  if (page === undefined) {
    throw new AppError(
      'VALIDATION',
      'tidak ada tab flow.google.com di browser ter-attach; buka studio Flow lebih dulu'
    );
  }

  const readiness = await page.evaluate<FlowReadiness>(`(() => {
    const prompt = document.querySelector('${PROMPT_SELECTOR}');
    const submit = [...document.querySelectorAll('button')].find((el) => /mulai pembuatan|start generation/i.test(el.getAttribute('aria-label') || ''));
    return {
      url: location.href,
      title: document.title,
      promptPresent: !!prompt,
      submitPresent: !!submit,
      challengeDetected: ${CHALLENGE_TEXT.toString()}.test(document.body.innerText || '')
    };
  })()`);

  return readiness;
}
