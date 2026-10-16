import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const root = resolve('.context/suk-147');
await mkdir(root, { recursive: true });
const url = process.env.STUDIO_PREVIEW_URL ?? 'http://127.0.0.1:55030/';
const snap = async (name) => {
  for (const [suffix, width, height] of [['desktop', 1440, 900], ['390px', 390, 844]]) {
    await page.setViewportSize({ width, height });
    if (await page.locator('#preview-frame').isVisible()) {
      await page.locator('#preview-frame').scrollIntoViewIfNeeded();
      await page.frameLocator('#preview-frame').locator('body').waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
      throw new Error(`${name} overflows at ${width}px`);
    }
    await page.screenshot({ path: resolve(root, `${name}-${suffix}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
};
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(url);
await page.getByText('Local library ready.').waitFor();
await snap('01-first-use');

await page.getByLabel('Publication URL').fill('https://example.com/blyg/');
await page.getByLabel('Title', { exact: true }).fill('A small place');
await page.getByRole('button', { name: 'Save publication settings' }).click();
await page.getByRole('button', { name: 'Write', exact: true }).click();
await page.getByRole('button', { name: 'New fragment' }).click();
await page.getByLabel('Markdown', { exact: true }).fill('A small place to write.\n\nHello **world**.');
await page.getByRole('button', { name: 'Preview', exact: true }).click();
await page.frameLocator('#preview-frame').getByText('Hello world.').waitFor();
await snap('02-populated-write');
await page.getByRole('button', { name: 'Publish version locally' }).click();
await page.getByText('1 versions').waitFor();
await snap('03-publication');
const publicDownload = page.waitForEvent('download');
await page.getByRole('button', { name: 'Download public site ZIP' }).click();
const zip = await publicDownload;
if (await zip.failure()) throw new Error('Public export failed');
await snap('04-export-complete');

await page.getByRole('button', { name: 'Read', exact: true }).click();
await snap('05-empty-read');
await page.getByText('Import RSS / Atom file (CORS fallback)').click();
await page.getByLabel('Original feed URL').fill('https://feed.example/rss.xml');
await page.getByLabel('Feed file', { exact: true }).setInputFiles({ name: 'feed.xml', mimeType: 'application/xml', buffer: Buffer.from('<rss version="2.0"><channel><title>Example feed</title><link>https://feed.example/</link><description>Feed</description><item><guid>post-one</guid><title>Post one</title><description>Read me</description><link>https://feed.example/one</link></item></channel></rss>') });
await page.getByRole('button', { name: 'Import feed' }).click();
await page.getByLabel('Private note').fill('A private thought about this post');
await page.getByRole('button', { name: 'Save private note' }).click();
await page.getByRole('button', { name: 'Like', exact: true }).click();
await page.getByRole('button', { name: 'Liked', exact: true }).waitFor();
await snap('06-populated-read');
let releaseFailure;
const failureGate = new Promise(resolve => { releaseFailure = resolve; });
await page.route('https://bad.example/**', async route => {
  await failureGate;
  await route.abort();
});
await page.getByLabel('Subscription URL', { exact: true }).fill('https://bad.example/blyg/');
await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
await page.locator('main[inert]').waitFor();
await snap('07-subscription-loading');
releaseFailure();
await page.locator('#status.error').waitFor();
await snap('08-subscription-failure');

await page.getByRole('button', { name: 'Library & publication' }).click();
const backupDownload = page.waitForEvent('download');
await page.getByRole('button', { name: 'Download private backup' }).click();
const backup = await backupDownload;
const backupBytes = await readFile(await backup.path());
await page.getByLabel('Inspect backup to restore').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backupBytes });
await page.locator('#restore').waitFor({ state: 'visible' });
await snap('09-restore-preview');
const preRestoreDownload = page.waitForEvent('download');
page.once('dialog', dialog => dialog.accept());
await page.getByRole('button', { name: 'Replace library with inspected backup' }).click();
const preRestoreBackup = await preRestoreDownload;
if (await preRestoreBackup.failure()) throw new Error('Pre-restore backup failed');
await page.getByText('Saved in this browser.', { exact: true }).waitFor();
await snap('10-restore-complete');

await page.getByRole('button', { name: 'Write', exact: true }).click();
await page.getByRole('button', { name: 'New thread' }).click();
for (let i = 0; i < 12; i++) {
  await page.keyboard.press('Tab');
  if (await page.evaluate(() => document.activeElement?.matches(':focus-visible') && document.activeElement?.tagName === 'BUTTON')) break;
}
const focus = await page.evaluate(() => ({text: document.activeElement?.textContent?.slice(0, 80), visible: document.activeElement?.matches(':focus-visible'), outline: getComputedStyle(document.activeElement).outline}));
if (!focus.visible) throw new Error('Keyboard focus was not visibly indicated');
console.log('Focus target:', focus);
await snap('11-keyboard-focus');
await page.route('https://blyg.protocol-institute.org/**', async route => {
  const relative = new URL(route.request().url()).pathname.slice(1) || 'index.html';
  try {
    await route.fulfill({
      status: 200,
      contentType: relative.endsWith('.json') ? 'application/json' : relative.endsWith('.xml') ? 'application/rss+xml' : 'text/html',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: await readFile(resolve('fixtures/wire/remote-blyg', relative)),
    });
  } catch {
    await route.fulfill({ status: 404, body: 'Missing fixture' });
  }
});
await page.getByRole('button', { name: 'Read', exact: true }).click();
await page.getByLabel('Subscription URL', { exact: true }).fill('https://blyg.protocol-institute.org/');
await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
await page.getByRole('button', { name: 'Refresh now', exact: true }).last().click();
await page.getByRole('button', { name: 'Quote in new thread', exact: true }).first().waitFor();
await page.getByRole('button', { name: 'Quote in new thread', exact: true }).first().click();
await page.getByRole('button', { name: 'Preview', exact: true }).click();
await page.frameLocator('#preview-frame').locator('.blyg-transclusion').first().waitFor();
await snap('12-quoted-thread-preview');
console.log('Captured 12 states at desktop and 390px in', root);
await browser.close();
