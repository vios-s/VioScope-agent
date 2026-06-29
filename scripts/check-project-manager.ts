import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createSessionToken, sessionCookieName } from '../src/mastra/auth/session';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { getUserByUsername, upsertLocalUser, type AuthUser, type UserRole } from '../src/mastra/db/users';

const stamp = Date.now();
const slug = `pm-${stamp}`;
const renamedSlug = `${slug}-renamed`;
const usernames = {
  owner: `pm.owner.${stamp}`,
  collaborator: `pm.collab.${stamp}`,
  ownerThemeCoordinator: `pm.owner.coord.${stamp}`,
  trackNameCoordinator: `pm.track.coord.${stamp}`,
  outsider: `pm.out.${stamp}`,
  pi: `pm.pi.${stamp}`,
};
const themeConfigPath = resolve('.local/checks', `project-manager-theme-${stamp}.yaml`);
const runtimeCachePath = resolve('.local/checks', `project-manager-runtime-${stamp}.json`);
process.env.VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH = runtimeCachePath;

function email(username: string): string {
  return `${username}@example.test`;
}

async function seedUser(username: string, role: UserRole = 'member'): Promise<AuthUser> {
  await upsertLocalUser({
    username,
    email: email(username),
    password: 'ProjectCheck1!',
    role,
    displayName: username,
    source: 'project_manager_check',
  });
  const user = await getUserByUsername(username);
  assert.ok(user, `Expected ${username} to exist.`);
  return user;
}

function cookieFor(user: AuthUser): string {
  return `${sessionCookieName}=${createSessionToken(user)}`;
}

function jsonRequest(path: string, body: unknown, user: AuthUser, method = 'POST'): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: cookieFor(user),
    },
    body: JSON.stringify(body),
  });
}

function getRequest(path: string, user: AuthUser): Request {
  return new Request(`http://localhost${path}`, {
    headers: {
      cookie: cookieFor(user),
    },
  });
}

function emptyRequest(path: string, user: AuthUser, method: string): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      cookie: cookieFor(user),
    },
  });
}

async function bodyOf<T>(response: Response): Promise<T & { error?: string }> {
  return (await response.json()) as T & { error?: string };
}

function projectContext(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

function updateContext(updateId: string) {
  return { params: Promise.resolve({ updateId }) };
}

async function cleanup() {
  const postgres = createPostgresClient('project-manager-check-cleanup');
  const userList = Object.values(usernames);

  try {
    await postgres.pool.query('DELETE FROM project_records WHERE slug = ANY($1::text[])', [[slug, renamedSlug]]).catch(() => undefined);
    await postgres.pool
      .query(
        `
          DELETE FROM audit_log
          WHERE actor_username = ANY($1::text[])
            OR target_id = $2
            OR metadata::text LIKE $3
        `,
        [userList, slug, `%${slug}%`],
      )
      .catch(() => undefined);
    await postgres.pool.query('DELETE FROM users WHERE username = ANY($1::text[])', [userList]).catch(() => undefined);
  } finally {
    await postgres.disconnect();
  }
}

async function installThemeConfigOverride() {
  await mkdir(dirname(themeConfigPath), { recursive: true });
  await writeFile(
    themeConfigPath,
    [
      'timezone: Europe/London',
      'cycle:',
      '  weekday: Wednesday',
      '  rotation: [AB, CD]',
      '  anchor_date: 2026-06-24',
      'pis: []',
      'administrator: Admin User',
      'themes:',
      '  - theme_id: A',
      '    title: Project Manager Track Name Is Not Theme Check',
      '    cycle_group: AB',
      '    weekday: Wednesday',
      '    time: "10:00"',
      '    duration_minutes: 60',
      '    coordinator: Track Name Coordinator',
      `    coordinator_user: ${usernames.trackNameCoordinator}`,
      '    members:',
      '      - Project Outsider',
      '    member_users:',
      `      - ${usernames.outsider}`,
      '  - theme_id: B',
      '    title: Project Manager Owner Theme Check',
      '    cycle_group: AB',
      '    weekday: Wednesday',
      '    time: "11:00"',
      '    duration_minutes: 60',
      '    coordinator: Owner Theme Coordinator',
      `    coordinator_user: ${usernames.ownerThemeCoordinator}`,
      '    members:',
      '      - Project Owner',
      '    member_users:',
      `      - ${usernames.owner}`,
      'submission:',
      '  progress_word_target: 50',
      '  update_types:',
      '    nothing_to_report:',
      '      duration_minutes: 0',
      '      questions_required: false',
      '    deep_dive:',
      '      duration_minutes: 30',
      '      questions_required: false',
      '    milestone_check:',
      '      duration_minutes: 10',
      '      questions_required: false',
      '    strategic_slot:',
      '      duration_minutes: 10',
      '      questions_required: false',
      'reminders: []',
      'permissions: {}',
      '',
    ].join('\n'),
  );

  await mkdir(dirname(runtimeCachePath), { recursive: true });
  await writeFile(
    runtimeCachePath,
    `${JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        settings: { THEME_MEETING_CONFIG_PATH: themeConfigPath },
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}

async function restoreThemeConfigOverride() {
  await rm(themeConfigPath, { force: true });
  await rm(runtimeCachePath, { force: true });
  delete process.env.VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH;
}

async function auditActionsForProject(projectId: string): Promise<string[]> {
  const postgres = createPostgresClient('project-manager-check-audit');

  try {
    const result = await postgres.pool.query<{ action: string }>(
      `
        SELECT action
        FROM audit_log
        WHERE actor_username = ANY($1::text[])
          AND (
            target_id = $2
            OR metadata::text LIKE $3
          )
        ORDER BY event_time ASC
      `,
      [[usernames.owner, usernames.pi], projectId, `%${slug}%`],
    );
    return result.rows.map((row: { action: string }) => row.action);
  } finally {
    await postgres.disconnect();
  }
}

async function auditActionExistsForActor(username: string, action: string): Promise<boolean> {
  const postgres = createPostgresClient('project-manager-check-audit-actor');

  try {
    const result = await postgres.pool.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM audit_log
          WHERE actor_username = $1
            AND action = $2
        ) AS exists
      `,
      [username, action],
    );
    return Boolean(result.rows[0]?.exists);
  } finally {
    await postgres.disconnect();
  }
}

async function main() {
  await cleanup();
  await installThemeConfigOverride();
  const owner = await seedUser(usernames.owner);
  const collaborator = await seedUser(usernames.collaborator);
  const ownerThemeCoordinator = await seedUser(usernames.ownerThemeCoordinator, 'organizer');
  const trackNameCoordinator = await seedUser(usernames.trackNameCoordinator, 'organizer');
  const outsider = await seedUser(usernames.outsider);
  const pi = await seedUser(usernames.pi, 'pi');

  const projectsRoute = await import('../app/api/projects/route');
  const projectRoute = await import('../app/api/projects/[projectId]/route');
  const updatesRoute = await import('../app/api/projects/[projectId]/updates/route');
  const commentsRoute = await import('../app/api/project-updates/[updateId]/comments/route');
  const planningRoute = await import('../app/api/projects/planning/route');

  try {
    const createResponse = await projectsRoute.POST(jsonRequest('/api/projects', {
      project: slug,
      title: 'Project manager smoke',
      ownerUsername: owner.username,
      collaborators: [collaborator.username, 'External Advisor'],
      track: 'A',
      stage: 3,
      stageProgress: 20,
      status: 'on_track',
      lifecycle: 'active',
      stageSince: '2026-06-10',
      target: 'finish ablation study',
      venue: 'ToyConf',
      submissionDeadline: '2026-09-15',
      notes: 'Project manager check note.',
    }, owner));
    const createBody = await bodyOf<{ project?: any }>(createResponse);
    assert.equal(createResponse.status, 200, createBody.error || 'Project create failed.');
    const project = createBody.project;
    assert.ok(project?.id, 'Expected created project id.');
    assert.equal(project.watchPath, `project://${owner.username}/${slug}`, 'Watch path should be assigned from owner and slug.');
    assert.equal(project.stageProgress, 20, 'Initial stage progress should be saved.');
    assert.ok(project.collaborators.includes('external advisor'), 'External collaborators should be saved.');
    assert.deepEqual(project.todos, [], 'New projects should start with an empty TODO list.');

    const duplicateResponse = await projectsRoute.POST(jsonRequest('/api/projects', {
      project: `${slug}-dupe`,
      title: 'Project manager smoke',
      ownerUsername: owner.username,
      track: 'A',
      stage: 1,
    }, owner));
    assert.equal(duplicateResponse.status, 400, 'Duplicate full project name for the same owner should be rejected.');

    const differentOwnerDuplicateResponse = await projectsRoute.POST(jsonRequest('/api/projects', {
      project: slug,
      title: 'Project manager smoke',
      ownerUsername: collaborator.username,
      track: 'A',
      stage: 1,
    }, collaborator));
    const differentOwnerDuplicateBody = await bodyOf<{ project?: any }>(differentOwnerDuplicateResponse);
    assert.equal(
      differentOwnerDuplicateResponse.status,
      200,
      differentOwnerDuplicateBody.error || 'Different owners should be allowed to use the same project name.',
    );

    const invalidTrackResponse = await projectsRoute.POST(jsonRequest('/api/projects', {
      project: `${slug}-bad-track`,
      title: 'Project manager bad track',
      ownerUsername: owner.username,
      track: 'C',
      stage: 1,
    }, owner));
    assert.equal(invalidTrackResponse.status, 400, 'Only track A/B should be accepted.');

    const ownerList = await bodyOf<{ projects?: any[] }>(
      await projectsRoute.GET(getRequest('/api/projects?includeArchived=true', owner)),
    );
    const collaboratorList = await bodyOf<{ projects?: any[] }>(
      await projectsRoute.GET(getRequest('/api/projects?includeArchived=true', collaborator)),
    );
    const outsiderList = await bodyOf<{ projects?: any[] }>(
      await projectsRoute.GET(getRequest('/api/projects?includeArchived=true', outsider)),
    );
    const ownerThemeCoordinatorList = await bodyOf<{ projects?: any[] }>(
      await projectsRoute.GET(getRequest('/api/projects?includeArchived=true', ownerThemeCoordinator)),
    );
    const trackNameCoordinatorList = await bodyOf<{ projects?: any[] }>(
      await projectsRoute.GET(getRequest('/api/projects?includeArchived=true', trackNameCoordinator)),
    );
    const piList = await bodyOf<{ projects?: any[] }>(
      await projectsRoute.GET(getRequest('/api/projects?includeArchived=true', pi)),
    );
    assert.ok(ownerList.projects?.some((nextProject) => nextProject.id === project.id), 'Owner should see project.');
    assert.equal(collaboratorList.projects?.some((nextProject) => nextProject.id === project.id), false, 'Collaborator metadata should not grant project access.');
    assert.equal(outsiderList.projects?.some((nextProject) => nextProject.id === project.id), false, 'Outsider should not see project.');
    assert.ok(ownerThemeCoordinatorList.projects?.some((nextProject) => nextProject.id === project.id), 'Owner theme coordinator should see project.');
    assert.equal(
      trackNameCoordinatorList.projects?.some((nextProject) => nextProject.id === project.id),
      false,
      'Coordinator of Theme A should not see a Track A project unless the owner is in that theme.',
    );
    assert.ok(piList.projects?.some((nextProject) => nextProject.id === project.id), 'PI should see project.');

    const titleLookupResponse = await projectRoute.GET(getRequest('/api/projects/Project%20manager%20smoke', owner), projectContext('Project manager smoke'));
    const titleLookupBody = await bodyOf<{ project?: any }>(titleLookupResponse);
    assert.equal(titleLookupResponse.status, 200, titleLookupBody.error || 'Full-name project lookup failed.');
    assert.equal(titleLookupBody.project?.id, project.id, 'Full project name should resolve to the project.');

    const slugTodoResponse = await projectRoute.PATCH(
      jsonRequest(`/api/projects/${project.id}`, {
        project: renamedSlug,
        watchPath: `project://${owner.username}/${renamedSlug}`,
        todos: [{ text: 'Draft reviewer response plan', dueDate: '2026-07-01', done: false }],
      }, owner, 'PATCH'),
      projectContext(project.id),
    );
    const slugTodoBody = await bodyOf<{ project?: any }>(slugTodoResponse);
    assert.equal(slugTodoResponse.status, 200, slugTodoBody.error || 'Project slug/TODO edit failed.');
    assert.equal(slugTodoBody.project?.project, renamedSlug, 'Project slug should be editable.');
    assert.equal(slugTodoBody.project?.watchPath, `project://${owner.username}/${renamedSlug}`, 'Watch path should follow edited slug.');
    assert.equal(slugTodoBody.project?.todos?.[0]?.text, 'Draft reviewer response plan', 'TODO text should be saved.');
    assert.equal(slugTodoBody.project?.todos?.[0]?.dueDate, '2026-07-01', 'TODO deadline should be saved.');

    const renamedLookupResponse = await projectRoute.GET(getRequest(`/api/projects/${renamedSlug}`, owner), projectContext(renamedSlug));
    const renamedLookupBody = await bodyOf<{ project?: any }>(renamedLookupResponse);
    assert.equal(renamedLookupResponse.status, 200, renamedLookupBody.error || 'Edited slug lookup failed.');
    assert.equal(renamedLookupBody.project?.id, project.id, 'Edited slug should resolve to the same project.');

    const forbiddenOwnerChange = await projectRoute.PATCH(
      jsonRequest(`/api/projects/${project.id}`, { ownerUsername: outsider.username }, owner, 'PATCH'),
      projectContext(project.id),
    );
    assert.equal(forbiddenOwnerChange.status, 400, 'Owner must not be allowed to transfer ownership.');

    const collaboratorDetailResponse = await projectRoute.GET(getRequest(`/api/projects/${project.id}`, collaborator), projectContext(project.id));
    assert.equal(collaboratorDetailResponse.status, 404, 'Collaborator metadata should not grant project detail access.');

    const trackNameCoordinatorDetailResponse = await projectRoute.GET(
      getRequest(`/api/projects/${project.id}`, trackNameCoordinator),
      projectContext(project.id),
    );
    assert.equal(trackNameCoordinatorDetailResponse.status, 404, 'Theme A coordinator should not see Track A project detail by track name.');

    const coordinatorEditResponse = await projectRoute.PATCH(
      jsonRequest(`/api/projects/${project.id}`, { status: 'blocked' }, ownerThemeCoordinator, 'PATCH'),
      projectContext(project.id),
    );
    assert.notEqual(coordinatorEditResponse.status, 200, 'Owner theme coordinator visibility should not grant project editing.');

    const piEditResponse = await projectRoute.PATCH(
      jsonRequest(`/api/projects/${project.id}`, { status: 'needs_input', blocker: 'Waiting for baseline rerun.' }, pi, 'PATCH'),
      projectContext(project.id),
    );
    const piEditBody = await bodyOf<{ project?: any }>(piEditResponse);
    assert.equal(piEditResponse.status, 200, piEditBody.error || 'PI project edit failed.');
    assert.equal(piEditBody.project?.status, 'needs_input');

    const firstUpdateResponse = await updatesRoute.POST(
      jsonRequest(`/api/projects/${project.id}/updates`, {
        date: '2026-06-20',
        type: 'progress',
        text: 'Finished first artifact summary.',
        stage: 3,
        stageProgress: 60,
        status: 'on_track',
        blocker: null,
        target: 'Finish ablation study.',
        milestone: true,
        artifact: {
          title: 'Design note',
          kind: 'document',
          path: 'gitlab://vios/project-manager-smoke/design.md',
          summary: 'Version one of the design note.',
        },
      }, owner),
      projectContext(project.id),
    );
    const firstUpdateBody = await bodyOf<{ project?: any }>(firstUpdateResponse);
    assert.equal(firstUpdateResponse.status, 200, firstUpdateBody.error || 'First project update failed.');
    assert.equal(firstUpdateBody.project?.stageProgress, 60, 'Progress update should sync project stage progress.');
    assert.equal(firstUpdateBody.project?.updates?.[0]?.milestone, true, 'Progress update should store milestone.');
    assert.equal(firstUpdateBody.project?.recommendation, 'milestone_check', 'Milestone should recommend milestone check.');

    const planningResponse = await planningRoute.POST(emptyRequest('/api/projects/planning', pi, 'POST'));
    const planningBody = await bodyOf<{ report?: any }>(planningResponse);
    assert.equal(planningResponse.status, 200, planningBody.error || 'Project planning scan failed.');
    assert.ok(
      planningBody.report?.attentionItems?.some((item: any) => item.id === project.id),
      'Planning scan should include milestone project in attention items.',
    );
    assert.ok(
      planningBody.report?.updatedProjects?.some((item: any) => item.id === project.id),
      'Planning scan should include recent project progress in updated projects.',
    );

    const longProgressResponse = await updatesRoute.POST(
      jsonRequest(`/api/projects/${project.id}/updates`, {
        date: '2026-06-20',
        type: 'progress',
        text: Array.from({ length: 51 }, (_, index) => `word${index}`).join(' '),
      }, owner),
      projectContext(project.id),
    );
    assert.equal(longProgressResponse.status, 400, 'Progress updates over 50 words should be rejected.');

    const secondUpdateResponse = await updatesRoute.POST(
      jsonRequest(`/api/projects/${project.id}/updates`, {
        date: '2026-06-21',
        type: 'artifact',
        text: 'Uploaded revised design note.',
        stage: 3,
        stageProgress: 65,
        status: 'on_track',
        artifact: {
          title: 'Design note',
          kind: 'document',
          path: 'gitlab://vios/project-manager-smoke/design.md',
          summary: 'Version two with revised scope.',
        },
      }, owner),
      projectContext(project.id),
    );
    const secondUpdateBody = await bodyOf<{ project?: any }>(secondUpdateResponse);
    assert.equal(secondUpdateResponse.status, 200, secondUpdateBody.error || 'Second project update failed.');
    const artifacts = secondUpdateBody.project?.artifacts || [];
    assert.equal(artifacts.length, 2, 'Both artifact versions should be retained.');
    assert.equal(artifacts.filter((artifact: any) => artifact.isCurrent).length, 1, 'Only one artifact version should be current.');
    assert.equal(artifacts.find((artifact: any) => artifact.isCurrent)?.summary, 'Version two with revised scope.');

    const updateId = secondUpdateBody.project?.updates?.[0]?.id;
    assert.ok(updateId, 'Expected latest update id.');
    const commentResponse = await commentsRoute.POST(
      jsonRequest(`/api/project-updates/${updateId}/comments`, { text: 'PI comment on this update.' }, pi),
      updateContext(updateId),
    );
    const commentBody = await bodyOf<{ project?: any }>(commentResponse);
    assert.equal(commentResponse.status, 200, commentBody.error || 'Project comment failed.');
    assert.ok(
      commentBody.project?.updates?.some((update: any) => update.comments?.some((comment: any) => comment.byUsername === pi.username)),
      'PI comment should be attached to the timeline update.',
    );

    const archiveResponse = await projectRoute.DELETE(
      emptyRequest(`/api/projects/${project.id}`, pi, 'DELETE'),
      projectContext(project.id),
    );
    const archiveBody = await bodyOf<{ project?: any }>(archiveResponse);
    assert.equal(archiveResponse.status, 200, archiveBody.error || 'Project archive failed.');
    assert.equal(archiveBody.project?.lifecycle, 'archived');

    const afterArchiveList = await bodyOf<{ projects?: any[] }>(
      await projectsRoute.GET(getRequest('/api/projects?includeArchived=true', pi)),
    );
    const activeDuplicateIndex = afterArchiveList.projects?.findIndex((nextProject) => nextProject.id === differentOwnerDuplicateBody.project?.id) ?? -1;
    const archivedIndex = afterArchiveList.projects?.findIndex((nextProject) => nextProject.id === project.id) ?? -1;
    assert.ok(archivedIndex >= 0, 'Archived project should still be visible when archived projects are included.');
    assert.equal(afterArchiveList.projects?.[archivedIndex]?.lifecycle, 'archived');
    assert.ok(activeDuplicateIndex >= 0 && activeDuplicateIndex < archivedIndex, 'Archived projects should be ranked below active projects.');

    const unarchiveResponse = await projectRoute.PATCH(
      jsonRequest(`/api/projects/${project.id}`, { lifecycle: 'active' }, pi, 'PATCH'),
      projectContext(project.id),
    );
    const unarchiveBody = await bodyOf<{ project?: any }>(unarchiveResponse);
    assert.equal(unarchiveResponse.status, 200, unarchiveBody.error || 'Project unarchive failed.');
    assert.equal(unarchiveBody.project?.lifecycle, 'active', 'Unarchive should restore the project to active lifecycle.');
    assert.equal(unarchiveBody.project?.archivedAt, null, 'Unarchive should clear archivedAt.');

    const actions = await auditActionsForProject(project.id);
    for (const action of ['project.create', 'project.update', 'project.update_add', 'project.update_comment', 'project.archive']) {
      assert.ok(actions.includes(action), `Expected audit action ${action}. Saw ${actions.join(', ')}`);
    }
    assert.equal(await auditActionExistsForActor(pi.username, 'project.planning_scan'), true, 'Planning scan should be audited.');

    console.log('Project manager check passed.');
    console.log(
      JSON.stringify(
        {
          projectVisibility: 'passed',
          ownerThemeCoordinatorVisibility: 'passed',
          trackNameCoordinatorDenied: 'passed',
          collaboratorVisibilityDenied: 'passed',
          piEdit: 'passed',
          archiveRank: 'passed',
          unarchive: 'passed',
          artifactCurrentVersion: 'passed',
          projectPlanningScan: 'passed',
          timelineComment: 'passed',
          auditActions: actions,
        },
        null,
        2,
      ),
    );
  } finally {
    await restoreThemeConfigOverride();
    await cleanup();
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await cleanup().catch(() => undefined);
  process.exitCode = 1;
});
