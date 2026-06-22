import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createSessionToken, sessionCookieName } from '../src/mastra/auth/session';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { getUserByUsername, upsertLocalUser, type AuthUser, type UserRole } from '../src/mastra/db/users';

const stamp = Date.now();
const slug = `pm-${stamp}`;
const usernames = {
  owner: `pm.owner.${stamp}`,
  collaborator: `pm.collab.${stamp}`,
  coordinator: `pm.coord.${stamp}`,
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
    await postgres.pool.query('DELETE FROM project_records WHERE slug = $1', [slug]).catch(() => undefined);
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
      '    title: Project Manager Coordinator Check',
      '    cycle_group: AB',
      '    weekday: Wednesday',
      '    time: "10:00"',
      '    duration_minutes: 60',
      '    coordinator: Project Coordinator',
      `    coordinator_user: ${usernames.coordinator}`,
      '    members:',
      '      - Project Owner',
      '    member_users:',
      `      - ${usernames.owner}`,
      'submission:',
      '  progress_word_target: 30',
      '  update_types:',
      '    nothing_to_report:',
      '      duration_minutes: 0',
      '      questions_required: false',
      '    short_update:',
      '      duration_minutes: 10',
      '      questions_required: true',
      '    deep_dive:',
      '      duration_minutes: 30',
      '      questions_required: true',
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

async function main() {
  await cleanup();
  await installThemeConfigOverride();
  const owner = await seedUser(usernames.owner);
  const collaborator = await seedUser(usernames.collaborator);
  const coordinator = await seedUser(usernames.coordinator, 'organizer');
  const outsider = await seedUser(usernames.outsider);
  const pi = await seedUser(usernames.pi, 'pi');

  const projectsRoute = await import('../app/api/projects/route');
  const projectRoute = await import('../app/api/projects/[projectId]/route');
  const updatesRoute = await import('../app/api/projects/[projectId]/updates/route');
  const commentsRoute = await import('../app/api/project-updates/[updateId]/comments/route');

  try {
    const createResponse = await projectsRoute.POST(jsonRequest('/api/projects', {
      project: slug,
      title: 'Project manager smoke',
      ownerUsername: owner.username,
      collaborators: [collaborator.username, 'External Advisor'],
      track: 'A',
      stage: 3,
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
    assert.ok(project.collaborators.includes('external advisor'), 'External collaborators should be saved.');

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
    const coordinatorList = await bodyOf<{ projects?: any[] }>(
      await projectsRoute.GET(getRequest('/api/projects?includeArchived=true', coordinator)),
    );
    const piList = await bodyOf<{ projects?: any[] }>(
      await projectsRoute.GET(getRequest('/api/projects?includeArchived=true', pi)),
    );
    assert.ok(ownerList.projects?.some((nextProject) => nextProject.id === project.id), 'Owner should see project.');
    assert.ok(collaboratorList.projects?.some((nextProject) => nextProject.id === project.id), 'Collaborator should see project.');
    assert.equal(outsiderList.projects?.some((nextProject) => nextProject.id === project.id), false, 'Outsider should not see project.');
    assert.ok(coordinatorList.projects?.some((nextProject) => nextProject.id === project.id), 'Track coordinator should see project.');
    assert.ok(piList.projects?.some((nextProject) => nextProject.id === project.id), 'PI should see project.');

    const titleLookupResponse = await projectRoute.GET(getRequest('/api/projects/Project%20manager%20smoke', owner), projectContext('Project manager smoke'));
    const titleLookupBody = await bodyOf<{ project?: any }>(titleLookupResponse);
    assert.equal(titleLookupResponse.status, 200, titleLookupBody.error || 'Full-name project lookup failed.');
    assert.equal(titleLookupBody.project?.id, project.id, 'Full project name should resolve to the project.');

    const forbiddenOwnerChange = await projectRoute.PATCH(
      jsonRequest(`/api/projects/${project.id}`, { ownerUsername: outsider.username }, owner, 'PATCH'),
      projectContext(project.id),
    );
    assert.equal(forbiddenOwnerChange.status, 400, 'Owner must not be allowed to transfer ownership.');

    const coordinatorEditResponse = await projectRoute.PATCH(
      jsonRequest(`/api/projects/${project.id}`, { status: 'blocked' }, coordinator, 'PATCH'),
      projectContext(project.id),
    );
    assert.notEqual(coordinatorEditResponse.status, 200, 'Coordinator visibility should not grant project editing.');

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
        type: 'artifact',
        text: 'Finished first artifact summary.',
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

    const secondUpdateResponse = await updatesRoute.POST(
      jsonRequest(`/api/projects/${project.id}/updates`, {
        date: '2026-06-21',
        type: 'artifact',
        text: 'Uploaded revised design note.',
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

    const actions = await auditActionsForProject(project.id);
    for (const action of ['project.create', 'project.update', 'project.update_add', 'project.update_comment', 'project.archive']) {
      assert.ok(actions.includes(action), `Expected audit action ${action}. Saw ${actions.join(', ')}`);
    }

    console.log('Project manager check passed.');
    console.log(
      JSON.stringify(
        {
          projectVisibility: 'passed',
          coordinatorVisibility: 'passed',
          piEdit: 'passed',
          artifactCurrentVersion: 'passed',
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
