import 'dotenv/config';
import assert from 'node:assert/strict';
import { chromium, startNextServer, stopServer, waitForServer } from './lib/playwright-smoke';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { createProject } from '../src/mastra/db/projects';
import { getUserByUsername, upsertLocalUser, type AuthUser, type UserRole } from '../src/mastra/db/users';

const password = 'ProjectUi1!';
const port = 3128;
const baseUrl = `http://127.0.0.1:${port}`;
const stamp = Date.now().toString(36);
const slug = `educational-agent-memory-ui-${stamp}`;
const title = 'Educational Agent with Memory UI Smoke';
const createdSlug = `fresh-playwright-project-${stamp}`;
const createdTitle = `Fresh Playwright Project ${stamp}`;
const users = {
  member: `project.ui.member.${stamp}`,
  emptyMember: `project.ui.empty.${stamp}`,
  pi: `project.ui.pi.${stamp}`,
  admin: `project.ui.admin.${stamp}`,
};

async function seedUser(username: string, role: UserRole, displayName: string): Promise<AuthUser> {
  await upsertLocalUser({
    username,
    role,
    email: `${username}@example.test`,
    displayName,
    password,
    passwordResetRequired: false,
    source: 'project_ui_check',
    metadata: { temporary_project_ui_check: true },
  });
  const user = await getUserByUsername(username);
  assert.ok(user, `Expected ${username} to exist.`);
  return user;
}

async function seedProject(owner: AuthUser) {
  return createProject(
    {
      project: slug,
      title,
      ownerUsername: owner.username,
      collaborators: ['External Education Partner'],
      track: 'A',
      stage: 2,
      stageProgress: 30,
      lifecycle: 'active',
      status: 'on_track',
      target: 'Prototype a tutoring agent with learner memory.',
      venue: 'AIED',
      submissionDeadline: '2026-09-30',
      notes: 'Temporary Playwright project UI smoke.',
    },
    owner,
  );
}

function startServer() {
  return startNextServer({ port, mode: 'start' });
}

async function login(browser: any, username: string, heading?: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Briefing').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  if (heading) {
    await page.getByRole('heading', { name: heading }).first().waitFor({ state: 'visible', timeout: 15_000 });
  }
  return { context, page };
}

async function checkEmptyMemberCreateProject(browser: any) {
  const { context, page } = await login(browser, users.emptyMember);
  try {
    await page.getByText('No visible projects yet. Add one to start tracking work.').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Add project' }).click();
    const modal = page.locator('.project-modal');
    await modal.waitFor({ state: 'visible' });
    await modal.getByLabel('Full project name').fill(createdTitle);
    assert.equal(await modal.getByLabel('Slug').inputValue(), createdSlug);
    assert.equal(await modal.getByLabel('Watch path').inputValue(), `project://${users.emptyMember}/${createdSlug}`);
    await modal.getByLabel('Collaborators').fill(`${users.member}, External Education Partner`);
    await modal.getByLabel('Venue').fill('ICLR');
    await modal.getByLabel('Submission deadline').fill('2026-10-15');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByRole('heading', { name: createdTitle }).waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByText('Track A').first().waitFor({ state: 'visible' });
  } finally {
    await context.close();
  }
}

async function checkMember(browser: any) {
  const { context, page } = await login(browser, users.member, title);
  try {
    await page.getByLabel(`Project details for ${title}`).click();
    await page.getByRole('button', { name: 'Details', exact: true }).waitFor({ state: 'visible' });
    const detailsForm = page.locator('.project-manage-form');
    assert.equal(await detailsForm.getByLabel('Full project name').inputValue(), title);
    await detailsForm.getByLabel('Venue').fill('AIED UX');
    await detailsForm.getByLabel('Deadline').fill('2026-10-01');
    await detailsForm.getByLabel('Notes').fill('Updated through Playwright project UI smoke.');
    const saveResponse = page.waitForResponse((response: any) => response.url().includes('/api/projects/') && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Save project' }).click();
    assert.equal((await saveResponse).ok(), true);
    assert.equal(await detailsForm.getByLabel('Venue').inputValue(), 'AIED UX');
    await page.getByLabel('Close project details').click();

    await page.getByLabel(`Progress update for ${title}`).click();
    const form = page.locator('.project-update-form');
    await form.waitFor({ state: 'visible' });
    await form.locator('select').nth(1).selectOption('3');
    await form.locator('input[type="number"]').fill('85');
    await form.locator('select').nth(2).selectOption('on_track');
    await form.locator('input[type="checkbox"]').check();
    await form.locator('textarea').nth(0).fill('Finish memory ablation and compare feedback quality.');
    await form.locator('textarea').nth(1).fill('');
    await form.locator('textarea').nth(2).fill(Array.from({ length: 51 }, (_, index) => `word${index}`).join(' '));
    await page.getByRole('button', { name: 'Add update' }).click();
    await page.getByText('Progress update must be 50 words or fewer.').waitFor({ state: 'visible' });

    const progressText = 'Finished baseline memory wiring and reached milestone for tutor evaluation.';
    await form.locator('textarea').nth(2).fill(progressText);
    await page.getByRole('button', { name: 'Add update' }).click();
    await page.getByText(progressText).waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByText('Stage 3 (85%)').waitFor({ state: 'visible' });
    await page.getByLabel('Close project details').click();
    await page.getByText('Stage 3 / 5 - 85%').waitFor({ state: 'visible' });

    await page.getByLabel(`Project details for ${title}`).click();
    await page.getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('dialog', { name: 'Archive project?' }).getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('heading', { name: 'Archived projects' }).waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByLabel(`Unarchive ${title}`).click();
    await page.getByText('Stage 3 / 5 - 85%').waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByRole('heading', { name: 'Archived projects' }).waitFor({ state: 'hidden' });
    await page.getByLabel('Close project details').click();

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Notifications' }).click();
    await page.getByRole('heading', { name: 'Notifications' }).waitFor({ state: 'visible' });
    await page.getByText('Web only').waitFor({ state: 'visible' });
    await page.getByLabel('Project progress reminders email notifications').click();
    await page.getByLabel('Theme meeting reminders web notifications').click();
    await page.getByRole('button', { name: 'Save notification settings' }).click();
    await page.getByText('Notification preferences saved.').waitFor({ state: 'visible', timeout: 15_000 });
    const preferences = await page.evaluate(async () => {
      const response = await fetch('/api/auth/me');
      const body = await response.json();
      return body.user.notificationPreferences;
    });
    assert.equal(preferences.chat_mentions.email, false, 'Chat mentions should remain web-only.');
    assert.equal(preferences.project_progress_reminders.email, false, 'Project progress email preference should persist.');
    assert.equal(preferences.theme_meeting_reminders.web, false, 'Theme meeting web preference should persist.');
  } finally {
    await context.close();
  }
}

async function checkPi(browser: any) {
  const { context, page } = await login(browser, users.pi);
  try {
    await page.getByText('All projects').first().waitFor({ state: 'visible' });
    await page.getByRole('cell', { name: title, exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('cell', { name: createdTitle, exact: true }).waitFor({ state: 'visible' });
    await page.getByText('85%').first().waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Run project scan' }).click();
    await page.getByText(/[1-9]\d* attention/).waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByText(/[1-9]\d* updated/).waitFor({ state: 'visible' });
    await page.getByRole('heading', { name: 'Project planning brief' }).waitFor({ state: 'visible' });
    await page.getByText('Finished baseline memory wiring and reached milestone for tutor evaluation.').first().waitFor({ state: 'visible' });
    await page.getByText(`${title} / ${users.member} / Milestone check / stage 3 (85%)`).first().click();
    await page.getByRole('button', { name: 'Progress update', exact: true }).waitFor({ state: 'visible' });
    await page.getByLabel('Close project details').click();
    await page.getByRole('button', { name: 'Add to agenda' }).first().click();
    await page.getByRole('button', { name: 'Added' }).first().waitFor({ state: 'visible' });
    await page.getByLabel(`Project details for ${title}`).click();
    await page.getByRole('button', { name: 'Details', exact: true }).waitFor({ state: 'visible' });
  } finally {
    await context.close();
  }
}

async function checkAdmin(browser: any) {
  const { context, page } = await login(browser, users.admin);
  try {
    await page.getByText('All projects').first().waitFor({ state: 'visible' });
    await page.getByRole('cell', { name: title, exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('cell', { name: createdTitle, exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Run project scan' }).click();
    await page.getByRole('heading', { name: 'Project planning brief' }).waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByText(createdTitle).first().waitFor({ state: 'visible' });
    await page.getByLabel(`Project details for ${createdTitle}`).click();
    await page.getByRole('button', { name: 'Details', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.project-manage-form').getByLabel('Owner').isDisabled(), false);
  } finally {
    await context.close();
  }
}

async function cleanup() {
  const postgres = createPostgresClient('project-ui-check-cleanup');
  try {
    await postgres.pool.query('DELETE FROM project_records WHERE slug = ANY($1::text[])', [[slug, createdSlug]]).catch(() => undefined);
    await postgres.pool
      .query('DELETE FROM audit_log WHERE actor_username = ANY($1::text[]) OR metadata::text LIKE $2', [
        Object.values(users),
        `%${stamp}%`,
      ])
      .catch(() => undefined);
    await postgres.pool.query('DELETE FROM users WHERE username = ANY($1::text[])', [Object.values(users)]).catch(() => undefined);
  } finally {
    await postgres.disconnect();
  }
}

async function main() {
  await cleanup();
  const member = await seedUser(users.member, 'member', 'Project UI Member');
  await seedUser(users.emptyMember, 'member', 'Empty Project UI Member');
  await seedUser(users.pi, 'pi', 'Project UI PI');
  await seedUser(users.admin, 'administrator', 'Project UI Admin');
  await seedProject(member);

  const server = startServer();
  try {
    await waitForServer(server, baseUrl, 80);
    const browser = await chromium.launch({ headless: true });
    try {
      await checkEmptyMemberCreateProject(browser);
      await checkMember(browser);
      await checkPi(browser);
      await checkAdmin(browser);
    } finally {
      await browser.close();
    }
    console.log('Project Playwright UI check passed.');
    console.log(
      JSON.stringify(
        {
          project: title,
          owner: users.member,
          uiCreatedProject: createdTitle,
          pi: users.pi,
          admin: users.admin,
          progressUpdate: 'stage 3 / 85% / milestone',
          projectPlanningBrief: 'attention and updated projects checked',
          archiveUnarchive: 'passed',
          emptyMemberCreate: 'passed',
          notificationSettings: 'passed',
          wordLimit: 'passed',
          baseUrl,
        },
        null,
        2,
      ),
    );
  } finally {
    await stopServer(server);
    await cleanup();
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await cleanup().catch(() => undefined);
  process.exitCode = 1;
});
