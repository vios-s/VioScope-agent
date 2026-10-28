import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, getFreePort, startNextServer, stopServer, waitForServer } from './playwright-smoke';

export async function checkSkeletonUi(cookieName: string, token: string) {
  const port = await getFreePort(); const base = `http://127.0.0.1:${port}`;
  const server = startNextServer({ port, mode: 'start', env: { ...process.env, EMAIL_NOTIFICATIONS_ENABLED: 'false' } });
  let browser;
  try {
    await waitForServer(server, base); browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: cookieName, value: token, url: base }]);
    const page = await context.newPage(); const errors: string[] = []; const requests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addLocatorHandler(page.locator('.welcome-dialog'), async () => { await page.getByLabel('Close welcome message').click(); });
    await page.route('**/api/submission-review', async route => {
      requests.push(route.request().postData() || '');
      await route.fulfill({ json: { report: '# Synthetic Skeleton Review', draftName: 'paper-skeleton', draftTruncated: false, draftChars: 100, finishReason: 'stop',
        structured: { verdict: 'CONDITIONAL', summary: 'Synthetic review: baseline evidence is missing.', appliedSkills: [{ name: 'vios-skeleton-lock', version: '0.1.0', sourcePath: 'synthetic/SKILL.md' }], findings: [{ area: 'Baselines', status: 'missing', evidence: ['missing'], gap: 'No completed baseline.', requiredAction: 'Provide baseline results.' }], reasonsToReject: [], checkmateQuestions: [], mitigations: [], humanSignOff: { leadPdra: 'pending', piOrOrganizer: 'pending', remainingEvidenceNeeded: ['Baseline evidence'] }, perSkillNotes: [{ skill: 'vios-skeleton-lock', notes: ['Advisory only.'] }] } } });
    });
    await page.goto(base + '/?view=checklists');
    await page.getByRole('tab', { name: 'Skeleton Lock', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Run All', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Run This Check', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Add evidence' }).waitFor();
    assert.equal(requests.length, 0);
    await page.getByRole('textbox', { name: /^Central claim and contributions/ }).fill('SYNTHETIC CLAIM: compare a smaller model against baseline.');
    await page.getByRole('textbox', { name: 'Project', exact: true }).fill('Synthetic skeleton project');
    await page.getByRole('button', { name: 'Run This Check', exact: true }).click();
    await page.getByText('Synthetic review: baseline evidence is missing.', { exact: true }).waitFor();
    assert.ok(requests[0].includes('[Not provided]'));
    assert.ok(requests[0].includes('SYNTHETIC CLAIM'));
    assert.ok(!requests[0].includes('vios-pdra-meta-review'));
    await page.getByRole('button', { name: 'Save Run', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /Saved review run/ }).waitFor();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.getByRole('button', { name: /Synthetic skeleton project/ }).click();
    await page.getByRole('status').filter({ hasText: /Opened review run/ }).waitFor();
    assert.match(await page.getByRole('textbox', { name: /^Central claim and contributions/ }).inputValue(), /SYNTHETIC CLAIM/);
    await mkdir('/tmp/vioscope-skeleton-ui', { recursive: true });
    await page.getByRole('heading', { name: 'Skeleton Lock', level: 1, exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/tmp/vioscope-skeleton-ui/desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('heading', { name: 'Skeleton Lock', level: 1, exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/tmp/vioscope-skeleton-ui/mobile.png' });
    await page.getByRole('combobox', { name: 'Input method', exact: true }).selectOption('paste');
    assert.equal(await page.getByRole('button', { name: 'Save Run', exact: true }).isDisabled(), true);
    await page.getByRole('textbox', { name: 'Paste Draft', exact: true }).fill('SYNTHETIC PASTED OUTLINE');
    await page.getByRole('button', { name: 'Run This Check', exact: true }).click();
    await page.getByText('Synthetic review: baseline evidence is missing.', { exact: true }).waitFor();
    assert.ok(requests[1].includes('SYNTHETIC PASTED OUTLINE'));
    assert.ok(!requests[1].includes('SYNTHETIC CLAIM'));
    await page.getByRole('combobox', { name: 'Input method', exact: true }).selectOption('upload');
    await page.locator('input[type=file]').setInputFiles({ name: 'outline.md', mimeType: 'text/markdown', buffer: Buffer.from('SYNTHETIC UPLOAD') });
    await page.getByRole('button', { name: 'Run This Check', exact: true }).click();
    await page.getByText('Synthetic review: baseline evidence is missing.', { exact: true }).waitFor();
    assert.ok(requests[2].includes('SYNTHETIC UPLOAD'));
    assert.ok(!requests[2].includes('SYNTHETIC PASTED OUTLINE'));
    assert.deepEqual(errors, []);
    console.log('Skeleton UI passed: blocks/paste/upload, scoped AI request (stubbed), real save/reopen, stale-result clearing and mobile layout.');
  } finally { await browser?.close(); await stopServer(server); }
}
