import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, getFreePort, startNextServer, stopServer, waitForServer } from './playwright-smoke';

export async function checkIdeaPitchUi(cookieName: string, token: string, peers?: { collaborator: string; pi: string }) {
  const port = await getFreePort(); const base = `http://127.0.0.1:${port}`;
  const server = startNextServer({ port, mode: 'start', env: { ...process.env, EMAIL_NOTIFICATIONS_ENABLED: 'false' } });
  const output = resolve(process.env.IDEA_UI_OUTPUT || '.local/checks/idea-title-delete');
  await mkdir(output, { recursive: true });
  let browser;
  try {
    await waitForServer(server, base); browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: cookieName, value: token, url: base }]);
    const page = await context.newPage(); const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addLocatorHandler(page.locator('.welcome-dialog'), async () => { await page.getByLabel('Close welcome message').click(); });
    await page.goto(base + '/?view=checklists');
    const panel = page.locator('.project-idea-check');
    const title = panel.getByRole('textbox', { name: /^Pitch title/ });
    const picker = page.getByRole('combobox', { name: 'Saved pitches', exact: true });
    await title.waitFor();
    assert.equal(await title.inputValue(), '');
    assert.equal(await panel.getByRole('button', { name: 'Delete pitch', exact: true }).count(), 0);
    const draft = {
      question: 'Can a smaller segmentation model count cells as accurately as our full-size baseline?',
      importance: 'Reducing inference cost could let small laboratories analyse microscopy images on one GPU.',
      contribution: 'Compare a compressed model against the full-size baseline on the same held-out images. Novelty remains unverified.',
      evidence: 'No pilot data yet. We hypothesize that redundant model parameters can be removed; this is an assumption.',
      validation: 'Use three random seeds and held-out images. Measure cell-count error, segmentation Dice, latency and memory. Report failures on rare cell shapes.',
      resources: 'One student, one GPU, two weeks, and an openly licensed microscopy dataset. Confirm the dataset license before starting.',
      risks: 'Compression may miss small cells. Compare errors by cell size and fall back to a less compressed model.',
      milestone: 'The student presents baseline results and failure examples at the next PI discussion in two weeks.'
    };
    await title.fill('DEMO — Low-cost cell counting');
    const { ideaFields } = await import('../../src/mastra/projects/idea-check');
    for (const field of ideaFields) await panel.locator('.idea-fields').getByRole('textbox', { name: new RegExp('^' + field.label) }).fill(draft[field.key as keyof typeof draft] || 'Synthetic plan for ' + field.label);
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'New pitch', exact: true }).click();
    assert.equal(await title.inputValue(), 'DEMO — Low-cost cell counting', 'Cancelled switching preserves unsaved title.');
    await panel.getByRole('button', { name: 'Save pitch draft', exact: true }).click();
    await panel.getByText('Draft saved. Human decision pending.', { exact: true }).waitFor();
    const id = await picker.inputValue(); assert.ok(id);
    if (peers) {
      await panel.getByRole('combobox', { name: 'Add people', exact: true }).selectOption('bob');
      await panel.getByRole('button', { name: 'Add collaborator', exact: true }).click();
      await panel.getByText('Shared with @bob.', { exact: true }).waitFor();
      await panel.locator('.idea-sharing').scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(output, 'sharing-controls.png') });
      const sharedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await sharedContext.addCookies([{ name: cookieName, value: peers.collaborator, url: base }]);
      const sharedPage = await sharedContext.newPage();
      await sharedPage.addLocatorHandler(sharedPage.locator('.welcome-dialog'), async () => { await sharedPage.getByLabel('Close welcome message').click(); });
      await sharedPage.goto(base + '/?view=checklists');
      await sharedPage.getByRole('combobox', { name: 'Saved pitches', exact: true }).selectOption(id);
      await sharedPage.getByText('Shared with you · Read only.', { exact: false }).waitFor();
      assert.equal(await sharedPage.getByRole('button', { name: 'Save pitch draft', exact: true }).count(), 0);
      assert.equal(await sharedPage.getByRole('button', { name: 'Delete pitch', exact: true }).count(), 0);
      assert.equal(await sharedPage.locator('.idea-history').count(), 0);
      await sharedPage.screenshot({ path: resolve(output, 'shared-pitch.png') });
      const piContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await piContext.addCookies([{ name: cookieName, value: peers.pi, url: base }]);
      const piPage = await piContext.newPage();
      await piPage.addLocatorHandler(piPage.locator('.welcome-dialog'), async () => { await piPage.getByLabel('Close welcome message').click(); });
      await piPage.goto(base + '/?view=checklists');
      await piPage.getByRole('heading', { name: 'PI / Admin overview · All pitches', exact: true }).waitFor();
      await piPage.getByRole('searchbox', { name: 'Find a pitch', exact: true }).fill('alice');
      await piPage.getByRole('button', { name: 'DEMO — Low-cost cell counting', exact: true }).waitFor();
      await piPage.screenshot({ path: resolve(output, 'pi-overview.png') });
      await piPage.getByRole('button', { name: 'DEMO — Low-cost cell counting', exact: true }).click();
      await piPage.locator('.idea-history').waitFor();
      assert.equal(await piPage.locator('.project-idea-check').getByRole('button', { name: 'Save pitch draft', exact: true }).count(), 1);
      await piPage.setViewportSize({ width: 390, height: 844 });
      assert.equal(await piPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await piPage.getByRole('heading', { name: 'PI / Admin overview · All pitches', exact: true }).scrollIntoViewIfNeeded();
      await piPage.screenshot({ path: resolve(output, 'pi-mobile.png') });
      // A concurrent editor advances the server version while this editor has a local draft.
      await title.fill('DEMO — Unsaved local title');
      const concurrent = await piContext.request.post(base + '/api/idea-pitches/' + id, { data: { operation: 'save', version: 1, title: 'DEMO — Concurrent revision', draft, source: null } });
      assert.equal(concurrent.status(), 200);
      await panel.getByRole('button', { name: 'Remove collaborator bob', exact: true }).click();
      await panel.getByText('Access removed for @bob.', { exact: true }).waitFor();
      assert.equal((await sharedContext.request.get(base + '/api/idea-pitches/' + id)).status(), 403);
      assert.equal(await title.inputValue(), 'DEMO — Unsaved local title');
      const conflict = page.waitForResponse(response => response.url() === base + '/api/idea-pitches/' + id && response.request().method() === 'POST');
      await panel.getByRole('button', { name: 'Save pitch draft', exact: true }).click();
      assert.equal((await conflict).status(), 409, 'Sharing refresh must preserve the old draft version and reject a stale save.');
      await panel.getByText('This pitch changed. Reload before saving.', { exact: false }).waitFor();
      page.once('dialog', dialog => dialog.dismiss());
      await panel.getByRole('button', { name: 'Reload saved version', exact: true }).click();
      assert.equal(await title.inputValue(), 'DEMO — Unsaved local title', 'Cancelled reload preserves edits.');
      page.once('dialog', dialog => dialog.accept());
      await panel.getByRole('button', { name: 'Reload saved version', exact: true }).click();
      await panel.getByRole('heading', { name: 'DEMO — Concurrent revision', exact: true }).waitFor();
      await sharedContext.close(); await piContext.close();
    }
    await title.fill('DEMO — Cell counting feasibility pilot');
    await panel.getByRole('button', { name: 'Save pitch draft', exact: true }).click();
    await panel.getByRole('heading', { name: 'DEMO — Cell counting feasibility pilot', exact: true }).waitFor();
    await page.reload(); await picker.waitFor(); await picker.selectOption(id);
    await panel.getByRole('heading', { name: 'DEMO — Cell counting feasibility pilot', exact: true }).waitFor();
    assert.equal(await title.inputValue(), 'DEMO — Cell counting feasibility pilot');
    const payload = await (await context.request.get(base + '/api/idea-pitches/' + id)).json();
    assert.equal(payload.history.length, peers ? 3 : 2);
    assert.equal(payload.history.at(-1).title, 'DEMO — Low-cost cell counting');
    assert.deepEqual(payload.current.draft, draft);
    assert.equal(await panel.getByRole('button', { name: 'Download approved pitch', exact: true }).count(), 0);
    await panel.getByRole('combobox', { name: /^Decision/ }).selectOption('proceed');
    await panel.getByRole('textbox', { name: 'Reason and evidence', exact: true }).fill('DEMO: The supervisory discussion agreed that a bounded two-week pilot can test this assumption. This is not a claim of proven novelty.');
    await panel.getByRole('textbox', { name: 'Next milestone or closure plan', exact: true }).fill('DEMO: Present cell-count errors, speed and rare-cell failure cases in two weeks.');
    await panel.getByLabel('I confirm this records the human decision after discussion with the supervisory team.', { exact: true }).check();
    await panel.getByRole('button', { name: 'Confirm decision', exact: true }).click();
    await panel.getByText('Human decision saved. No project created.', { exact: true }).waitFor();
    const formats = panel.getByRole('combobox', { name: /^Download format/ });
    assert.equal(await formats.inputValue(), 'docx');
    for (const format of ['docx', 'pdf', 'md', 'txt']) {
      await formats.selectOption(format);
      const pendingDownload = page.waitForEvent('download');
      await panel.getByRole('button', { name: 'Download approved pitch', exact: true }).click();
      const download = await pendingDownload;
      assert.equal(download.suggestedFilename(), `idea-pitch-v${peers ? 4 : 3}.${format}`);
      await download.saveAs(resolve(output, `approved-cell-counting.${format}`));
      assert.equal(await download.failure(), null);
    }
    await panel.locator('.idea-export').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, 'approved-download.png') });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await panel.locator('.idea-record-header').scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: resolve(output, `saved-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await panel.getByRole('button', { name: 'Delete pitch', exact: true }).click();
    assert.equal(await panel.getByRole('button', { name: 'Permanently delete pitch', exact: true }).isEnabled(), false);
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await context.request.get(base + '/api/idea-pitches/' + id)).status(), 200);
    await panel.getByRole('button', { name: 'Delete pitch', exact: true }).click();
    await panel.getByLabel('I understand this pitch and its history will be deleted.', { exact: true }).check();
    await panel.locator('.idea-delete-confirm').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, 'delete-confirmation.png') });
    await panel.getByRole('button', { name: 'Permanently delete pitch', exact: true }).click();
    await page.waitForFunction(() => (document.querySelector('.idea-pitch-toolbar select') as HTMLSelectElement)?.value === '');
    assert.equal(await title.inputValue(), '');
    assert.equal((await context.request.get(base + '/api/idea-pitches/' + id)).status(), 403);
    assert.equal(await picker.locator(`option[value="${id}"]`).count(), 0);
    // A title is required before the draft can be saved.
    await panel.locator('.idea-fields').getByRole('textbox', { name: /^The Pain Point/ }).fill('DEMO — Can a smaller model work?');
    await panel.getByRole('button', { name: 'Save pitch draft', exact: true }).click();
    assert.equal(await title.evaluate((input: HTMLInputElement) => input.validity.valueMissing), true);
    await title.fill('DEMO — Required title');
    await panel.getByRole('button', { name: 'Save pitch draft', exact: true }).click();
    await panel.getByRole('heading', { name: 'DEMO — Required title', exact: true }).waitFor();
    assert.equal(await title.inputValue(), 'DEMO — Required title');
    await panel.getByRole('button', { name: 'Delete pitch', exact: true }).click();
    await panel.getByLabel('I understand this pitch and its history will be deleted.', { exact: true }).check();
    await panel.getByRole('button', { name: 'Permanently delete pitch', exact: true }).click();
    await page.waitForFunction(() => (document.querySelector('.idea-pitch-toolbar select') as HTMLSelectElement)?.value === '');
    const handoffPitch = await (await context.request.post(base + '/api/idea-pitches', { data: { title: 'DEMO — Project meeting handoff' } })).json();
    const handoffUrl = base + '/api/idea-pitches/' + handoffPitch.id;
    assert.equal((await context.request.post(handoffUrl, { data: { operation: 'save', version: 0, draft } })).status(), 200);
    assert.equal((await context.request.post(handoffUrl, { data: { operation: 'decide', version: 1, confirmed: true, decision: { outcome: 'proceed', rationale: 'A bounded pilot is agreed.', nextMilestone: 'Compare three pilot runs.' } } })).status(), 200);
    await page.reload(); await picker.waitFor(); await picker.selectOption(handoffPitch.id);
    await panel.getByRole('textbox', { name: 'First next action', exact: true }).fill('Run three synthetic pilot comparisons');
    await panel.getByLabel('Action deadline', { exact: true }).fill('2099-11-06');
    await panel.getByLabel('I confirm this approved pitch should now become a project.', { exact: true }).check();
    await panel.getByRole('button', { name: 'Create project', exact: true }).click();
    await panel.getByText('Project created. The original pitch is retained.', { exact: true }).waitFor();
    const converted = await (await context.request.get(handoffUrl)).json();
    assert.ok(converted.pitch.projectId);
    // Choose a future meeting through the normal GET API while keeping the browser submission real.
    await page.route('**/api/theme-meetings', route => route.continue({ url: base + '/api/theme-meetings?date=2099-11-04' }));
    await page.goto(base + '/?view=meeting');
    const meetingForm = page.locator('.theme-update-form');
    await meetingForm.getByRole('combobox', { name: 'Project source', exact: true }).selectOption(converted.pitch.projectId);
    await meetingForm.getByText('Run three synthetic pilot comparisons', { exact: false }).waitFor();
    await meetingForm.getByRole('combobox', { name: 'Slot type', exact: true }).selectOption('deep_dive');
    await meetingForm.getByRole('textbox', { name: /^Progress/ }).fill('The approved pilot is planned. We need feedback on the comparison protocol.');
    assert.equal(await meetingForm.getByRole('combobox', { name: 'Slot type', exact: true }).locator('option').count(), 3);
    const stage = meetingForm.getByRole('textbox', { name: 'Project stage', exact: true });
    assert.equal(await stage.inputValue(), '1: idea/proposal');
    await meetingForm.getByRole('checkbox', { name: /^Link this project/ }).check();
    assert.equal(await stage.inputValue(), '1: idea/proposal');
    assert.equal(await stage.getAttribute('readonly'), '');
    await meetingForm.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, 'project-meeting-handoff.png') });
    await meetingForm.getByRole('button', { name: /Submit update|Save changes/ }).click();
    await page.getByRole('status').filter({ hasText: /Update submitted.|Changes saved./ }).waitFor();
    const meetingPayload = await (await context.request.get(base + '/api/theme-meetings?date=2099-11-04')).json();
    const entry = meetingPayload.submissionPlan.meetings[0].agenda_items[0];
    assert.equal(entry.project_context.projectId, converted.pitch.projectId);
    assert.equal(entry.project_context.ownerUsername, 'alice');
    assert.equal(entry.project_context.stage, 1);
    assert.equal(entry.project_context.actions[0].dueDate, '2099-11-06');
    await page.reload();
    await meetingForm.getByRole('checkbox', { name: /^Link this project/ }).waitFor();
    assert.equal(await meetingForm.getByRole('combobox', { name: 'Project source', exact: true }).inputValue(), converted.pitch.projectId);
    assert.equal(await meetingForm.getByRole('checkbox', { name: /^Link this project/ }).isChecked(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await meetingForm.getByRole('checkbox', { name: /^Link this project/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, 'project-meeting-mobile.png') });
    await meetingForm.getByRole('checkbox', { name: /^Link this project/ }).uncheck();
    await meetingForm.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Changes saved.' }).waitFor();
    const unlinked = await (await context.request.get(base + '/api/theme-meetings?date=2099-11-04')).json();
    assert.equal(unlinked.submissionPlan.meetings[0].agenda_items[0].project_context, undefined);
    assert.deepEqual(errors, []);
    console.log('Synthetic UI passed: complete pitch, title rename/history/reload, unsaved-switch protection, delete cancel/confirm, optional title, desktop/tablet/mobile. Screenshots: ' + output);
  } finally { await browser?.close(); await stopServer(server); }
}
