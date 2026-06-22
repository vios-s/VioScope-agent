import 'dotenv/config';
import assert from 'node:assert/strict';
import { createSessionToken, sessionCookieName } from '../src/mastra/auth/session';
import {
  importLocalChatSessions,
  listChatNotificationsForUser,
  listChatSessionsForUser,
  listMentionableUsers,
  markChatNotificationsRead,
  saveChatTurn,
  shareChatSessionWithMentions,
} from '../src/mastra/db/chat';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { createProject, listProjectsForUser, updateProject } from '../src/mastra/db/projects';
import { getUserByUsername, upsertLocalUser, type AuthUser } from '../src/mastra/db/users';

const stamp = Date.now();
const ownerName = `chat.owner.${stamp}`;
const receiverName = `chat.receiver.${stamp}`;
const inactiveName = `chat.inactive.${stamp}`;
const outsiderName = `chat.outsider.${stamp}`;
const sessionId = `chat-collab-${stamp}`;
const legacyThreadId = `legacy-thread-${stamp}`;
const projectSlug = `chat-private-project-${stamp}`;

function email(username: string): string {
  return `${username}@example.test`;
}

async function seedUser(username: string): Promise<AuthUser> {
  await upsertLocalUser({
    username,
    email: email(username),
    password: 'ChatCollab1!',
    role: 'member',
    displayName: username,
    source: 'chat_collaboration_check',
  });
  const user = await getUserByUsername(username);
  assert.ok(user, `Expected ${username} to exist.`);
  return user;
}

async function cleanup() {
  const postgres = createPostgresClient('chat-collaboration-cleanup');
  try {
    await postgres.pool.query('DELETE FROM chat_sessions WHERE id = ANY($1::text[])', [
      [sessionId, `legacy-${ownerName}-${legacyThreadId}`],
    ]).catch(() => undefined);
    await postgres.pool.query('DELETE FROM project_records WHERE slug = $1', [projectSlug]).catch(() => undefined);
    await postgres.pool
      .query('DELETE FROM audit_log WHERE actor_username = ANY($1::text[])', [[ownerName, receiverName, inactiveName, outsiderName]])
      .catch(() => undefined);
    await postgres.pool
      .query('DELETE FROM users WHERE username = ANY($1::text[])', [[ownerName, receiverName, inactiveName, outsiderName]])
      .catch(() => undefined);
  } finally {
    await postgres.disconnect();
  }
}

async function disableUser(username: string) {
  const postgres = createPostgresClient('chat-collaboration-disable-user');
  try {
    await postgres.pool.query("UPDATE users SET provisioning_status = 'disabled' WHERE username = $1", [username]);
  } finally {
    await postgres.disconnect();
  }
}

function cookieFor(user: AuthUser): string {
  return `${sessionCookieName}=${createSessionToken(user)}`;
}

async function main() {
  await cleanup();
  const owner = await seedUser(ownerName);
  const receiver = await seedUser(receiverName);
  const inactive = await seedUser(inactiveName);
  const outsider = await seedUser(outsiderName);
  await disableUser(inactive.username);

  try {
    const mentionable = await listMentionableUsers();
    assert.ok(mentionable.some((user) => user.username === receiver.username), 'Active receiver should be mentionable.');
    assert.equal(mentionable.some((user) => user.username === inactive.username), false, 'Disabled user should not be mentionable.');

    await saveChatTurn({
      sessionId,
      actor: owner,
      userText: `Please review this VioScope thread @${receiver.username} @missing.user`,
      assistantText: 'Saved for collaboration check.',
      assistantStatus: 'answer',
      sources: [],
    });

    const mentions = await shareChatSessionWithMentions({
      sessionId,
      actor: owner,
      message: `Please review this VioScope thread @${receiver.username} @missing.user`,
    });
    assert.deepEqual(mentions.shared.map((user) => user.username), [receiver.username]);
    assert.deepEqual(mentions.unknown, ['missing.user']);

    const ownerSessions = await listChatSessionsForUser(owner.id);
    const ownerSession = ownerSessions.find((session) => session.threadId === sessionId);
    assert.equal(ownerSession?.membershipKind, 'owner', 'Owner should see the session in owned history.');
    assert.ok(ownerSession?.messages.length, 'Owner history should include server-side messages.');

    const receiverSessions = await listChatSessionsForUser(receiver.id);
    const receiverSession = receiverSessions.find((session) => session.threadId === sessionId);
    assert.equal(receiverSession?.membershipKind, 'shared', 'Receiver should see shared membership.');
    assert.equal(
      receiverSessions.filter((session) => session.membershipKind !== 'shared').some((session) => session.threadId === sessionId),
      false,
      'Shared session should not appear as receiver-owned history.',
    );

    let notifications = await listChatNotificationsForUser(receiver.id);
    assert.equal(notifications.length, 1, 'Mention should create one notification.');
    assert.equal(notifications[0]!.sessionId, sessionId);
    assert.equal(notifications[0]!.readAt, null, 'Mention notification should start unread.');

    notifications = await markChatNotificationsRead({ userId: receiver.id, notificationId: notifications[0]!.id });
    assert.ok(notifications[0]!.readAt, 'Notification read state should persist.');
    assert.equal(notifications.length, 1, 'Read notifications should remain historically visible.');

    const imported = await importLocalChatSessions({
      actor: owner,
      sessions: [
        {
          threadId: legacyThreadId,
          title: 'Legacy mention import',
          messages: [
            {
              role: 'user',
              text: `Old local browser message mentioning @${receiver.username}`,
            },
            {
              role: 'assistant',
              text: 'Imported response.',
            },
          ],
        },
      ],
    });
    assert.equal(imported, 1, 'Legacy chat import should create a server-side owner session.');
    notifications = await listChatNotificationsForUser(receiver.id);
    assert.equal(notifications.length, 1, 'Legacy import must not send mention notifications.');

    const project = await createProject({
      project: projectSlug,
      title: `Chat Private Project ${stamp}`,
      ownerUsername: owner.username,
      track: 'A',
      stage: 1,
      status: 'on_track',
    }, owner);
    const receiverProjects = await listProjectsForUser(receiver, { includeArchived: true });
    assert.equal(
      receiverProjects.some((candidate) => candidate.id === project.id),
      false,
      'Chat sharing should not grant project visibility.',
    );
    await assert.rejects(
      () => updateProject(project.id, { notes: 'Receiver should not write this.' }, receiver),
      /not found|access denied|permission/i,
      'Chat sharing should not grant project write permission.',
    );

    const sessionsRoute = await import('../app/api/chat/sessions/route');
    const sessionsResponse = await sessionsRoute.GET(
      new Request('http://localhost/api/chat/sessions', {
        headers: { cookie: cookieFor(receiver) },
      }),
    );
    const sessionsBody = (await sessionsResponse.json()) as { sessions?: Array<{ threadId: string; membershipKind: string }> };
    assert.equal(sessionsResponse.status, 200, 'Chat sessions API should return server sessions.');
    assert.ok(
      sessionsBody.sessions?.some((session) => session.threadId === sessionId && session.membershipKind === 'shared'),
      'Chat sessions API should expose shared sessions.',
    );

    console.log('Chat collaboration check passed.');
    console.log(
      JSON.stringify(
        {
          serverSessions: 'passed',
          mentionAutocomplete: 'passed',
          mentionShare: 'passed',
          notificationReadState: 'passed',
          legacyImportNoNotifications: 'passed',
          noPermissionEscalation: 'passed',
        },
        null,
        2,
      ),
    );
  } finally {
    await cleanup();
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await cleanup().catch(() => undefined);
  process.exitCode = 1;
});
