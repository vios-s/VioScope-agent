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
const reviewPiName = `chat.review.pi.${stamp}`;
const reviewPdraName = `chat.review.pdra.${stamp}`;
const outsiderName = `chat.outsider.${stamp}`;
const sessionId = `chat-collab-${stamp}`;
const mutedSessionId = `chat-muted-${stamp}`;
const legacyThreadId = `legacy-thread-${stamp}`;
const projectSlug = `chat-private-project-${stamp}`;
const ownerAvatarUrl = 'data:image/png;base64,Y2hhdC1vd25lcg==';

function email(username: string): string {
  return `${username}@example.test`;
}

async function seedUser(username: string): Promise<AuthUser> {
  await upsertLocalUser({
    username,
    email: email(username),
    password: 'ChatCollab1!',
    role: username === reviewPiName ? 'pi' : 'member',
    displayName: username,
    source: 'chat_collaboration_check',
    metadata: username === ownerName ? { avatar_url: ownerAvatarUrl } : undefined,
  });
  const user = await getUserByUsername(username);
  assert.ok(user, `Expected ${username} to exist.`);
  return user;
}

async function cleanup() {
  const postgres = createPostgresClient('chat-collaboration-cleanup');
  try {
    await postgres.pool.query('DELETE FROM chat_sessions WHERE id = ANY($1::text[]) OR id LIKE $2', [[sessionId, mutedSessionId], `%${legacyThreadId}`]).catch(() => undefined);
    await postgres.pool.query('DELETE FROM project_records WHERE slug = $1', [projectSlug]).catch(() => undefined);
    await postgres.pool
      .query('DELETE FROM audit_log WHERE actor_username = ANY($1::text[])', [[ownerName, receiverName, inactiveName, outsiderName, reviewPiName, reviewPdraName]])
      .catch(() => undefined);
    await postgres.pool
      .query('DELETE FROM users WHERE username = ANY($1::text[])', [[ownerName, receiverName, inactiveName, outsiderName, reviewPiName, reviewPdraName]])
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
  await seedUser(reviewPiName);
  await seedUser(reviewPdraName);
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
    const ownerUserMessage = ownerSession?.messages.find((message) => message.role === 'user');
    assert.equal(ownerUserMessage?.actorUsername, owner.username, 'Owner user message should expose actor username.');
    assert.equal(ownerUserMessage?.actorDisplayName, owner.displayName, 'Owner user message should expose actor display name.');
    assert.equal(ownerUserMessage?.actorAvatarUrl, ownerAvatarUrl, 'Owner user message should expose avatar URL.');

    const receiverSessions = await listChatSessionsForUser(receiver.id);
    const receiverSession = receiverSessions.find((session) => session.threadId === sessionId);
    assert.equal(receiverSession?.membershipKind, 'shared', 'Receiver should see shared membership.');
    assert.equal(
      receiverSession?.messages.find((message) => message.role === 'user')?.actorUsername,
      owner.username,
      'Shared receiver should see who sent each user message.',
    );
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
      piUsername: reviewPiName, pdraUsername: reviewPdraName,
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

    // Chat route: members of a shared session can reply; outsiders are refused before any model call; errors never echo ids.
    const { mastra } = await import('../src/mastra');
    const agent = mastra.getAgent('vioscopeAgent') as unknown as { generate: (message: string, options: Record<string, unknown>) => Promise<unknown> };
    const generateCalls: Array<Record<string, unknown>> = [];
    let replies: string[] = [];
    agent.generate = async (_message, options) => {
      generateCalls.push(options);
      return { text: replies.shift() ?? 'Shared reply recorded.', toolResults: [], toolCalls: [], finishReason: 'stop' };
    };
    const chatRoute = await import('../app/api/chat/route');
    const postChat = (user: AuthUser, message: string) => chatRoute.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieFor(user) },
      body: JSON.stringify({ threadId: sessionId, message }),
    }));
    const memberReply = await postChat(receiver, 'Please summarise the VioScope thread so far.');
    assert.equal(memberReply.status, 200, await memberReply.clone().text());
    assert.equal(generateCalls.at(-1)?.memory, undefined, 'Never reopen private augmented model history.');
    assert.ok(Array.isArray(generateCalls.at(-1)?.context), 'Shared replies receive member-visible history.');
    assert.ok(
      (await listChatSessionsForUser(owner.id)).find((session) => session.threadId === sessionId)?.messages
        .some((message) => message.actorUsername === receiver.username),
      'The shared member turn is saved in the owner session.',
    );
    const callsBeforeOutsider = generateCalls.length;
    const outsiderReply = await postChat(outsider, 'Please summarise the VioScope thread so far.');
    const outsiderBody = (await outsiderReply.json()) as { error: string };
    assert.equal(outsiderReply.status, 404, 'Outsiders cannot post into a session they are not a member of.');
    assert.equal(generateCalls.length, callsBeforeOutsider, 'Outsiders are refused before generation.');
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    assert.doesNotMatch(outsiderBody.error, uuidPattern);
    agent.generate = async () => {
      throw new Error(`Thread ${sessionId} belongs to resource ${owner.id} but resource ${receiver.id} was provided`);
    };
    const failedReply = await postChat(receiver, 'Please summarise the VioScope thread so far.');
    const failedBody = (await failedReply.json()) as { error: string };
    assert.equal(failedReply.status, 500);
    assert.doesNotMatch(failedBody.error, uuidPattern, 'Internal errors are not echoed.');
    assert.equal(failedBody.error.includes(sessionId), false);
    // A non-English answer is regenerated once in English, whatever language was requested.
    agent.generate = async (_message, options) => {
      generateCalls.push(options);
      return { text: replies.shift() ?? 'English answer.', toolResults: [], toolCalls: [], finishReason: 'stop' };
    };
    replies = [String.fromCodePoint(0x8fd9, 0x662f, 0x4e00, 0x4e2a, 0x4e2d, 0x6587, 0x56de, 0x7b54, 0x3002), 'The answer is given in English.'];
    const callsBeforeLanguage = generateCalls.length;
    const languageReply = await postChat(receiver, `Please answer in ${String.fromCodePoint(0x4e2d, 0x6587)}: what is the VioScope thread about?`);
    assert.equal(((await languageReply.json()) as { text: string }).text, 'The answer is given in English.');
    assert.equal(generateCalls.length - callsBeforeLanguage, 2, 'Exactly one English regeneration.');

    const renamedTitle = `Renamed collaboration chat ${stamp}`;
    const renameOwnedResponse = await sessionsRoute.PATCH(
      new Request('http://localhost/api/chat/sessions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: cookieFor(owner) },
        body: JSON.stringify({ threadId: sessionId, title: renamedTitle }),
      }),
    );
    const renameOwnedBody = (await renameOwnedResponse.json()) as { session?: { title: string } };
    assert.equal(renameOwnedResponse.status, 200, 'Owner should be able to rename an owned session.');
    assert.equal(renameOwnedBody.session?.title, renamedTitle);
    assert.equal(
      (await listChatSessionsForUser(owner.id)).find((session) => session.threadId === sessionId)?.title,
      renamedTitle,
      'Renamed owned session should persist in owner history.',
    );

    const renameSharedResponse = await sessionsRoute.PATCH(
      new Request('http://localhost/api/chat/sessions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: cookieFor(receiver) },
        body: JSON.stringify({ threadId: sessionId, title: 'Receiver rename attempt' }),
      }),
    );
    assert.equal(renameSharedResponse.status, 403, 'Shared receiver should not rename the owner session.');

    const removeSharedResponse = await sessionsRoute.DELETE(
      new Request('http://localhost/api/chat/sessions', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', cookie: cookieFor(receiver) },
        body: JSON.stringify({ threadId: sessionId }),
      }),
    );
    const removeSharedBody = (await removeSharedResponse.json()) as { result?: string };
    assert.equal(removeSharedResponse.status, 200, 'Shared receiver should be able to remove the shared session.');
    assert.equal(removeSharedBody.result, 'removed');
    assert.equal(
      (await listChatSessionsForUser(receiver.id)).some((session) => session.threadId === sessionId),
      false,
      'Removed shared session should disappear from receiver history.',
    );
    assert.ok(
      (await listChatSessionsForUser(owner.id)).some((session) => session.threadId === sessionId),
      'Removing a shared session should not delete the owner history.',
    );
    assert.equal((await listChatNotificationsForUser(receiver.id)).length, 0, 'Removing a shared session should clear its notification.');

    const accountRoute = await import('../app/api/account/route');
    const mutedPrefsResponse = await accountRoute.PATCH(
      new Request('http://localhost/api/account', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: cookieFor(receiver) },
        body: JSON.stringify({
          notificationPreferences: {
            chat_mentions: { web: false, email: true },
          },
        }),
      }),
    );
    assert.equal(mutedPrefsResponse.status, 200, 'Receiver should save chat notification preferences.');
    await saveChatTurn({
      sessionId: mutedSessionId,
      actor: owner,
      userText: `Muted mention check @${receiver.username}`,
      assistantText: 'Saved muted collaboration check.',
      assistantStatus: 'answer',
      sources: [],
    });
    const mutedMentions = await shareChatSessionWithMentions({
      sessionId: mutedSessionId,
      actor: owner,
      message: `Muted mention check @${receiver.username}`,
    });
    assert.deepEqual(mutedMentions.shared.map((user) => user.username), [receiver.username]);
    assert.ok(
      (await listChatSessionsForUser(receiver.id)).some((session) => session.threadId === mutedSessionId),
      'Muted receiver should still get shared session access.',
    );
    assert.equal(
      (await listChatNotificationsForUser(receiver.id)).length,
      0,
      'Muted chat mention should not create a web notification.',
    );

    const deleteOwnedResponse = await sessionsRoute.DELETE(
      new Request('http://localhost/api/chat/sessions', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', cookie: cookieFor(owner) },
        body: JSON.stringify({ threadId: sessionId }),
      }),
    );
    const deleteOwnedBody = (await deleteOwnedResponse.json()) as { result?: string };
    assert.equal(deleteOwnedResponse.status, 200, 'Owner should be able to delete the owned session.');
    assert.equal(deleteOwnedBody.result, 'deleted');
    assert.equal(
      (await listChatSessionsForUser(owner.id)).some((session) => session.threadId === sessionId),
      false,
      'Deleted owned session should disappear from owner history.',
    );

    console.log('Chat collaboration check passed.');
    console.log(
      JSON.stringify(
        {
          serverSessions: 'passed',
          mentionAutocomplete: 'passed',
          mentionShare: 'passed',
          notificationReadState: 'passed',
          mutedMentionNotification: 'passed',
          legacyImportNoNotifications: 'passed',
          ownedSessionRename: 'passed',
          sharedRenameDenied: 'passed',
          sharedSessionRemoval: 'passed',
          ownedSessionDelete: 'passed',
          noPermissionEscalation: 'passed',
          sharedMemberReply: 'passed',
          outsiderRejectedBeforeGeneration: 'passed',
          noInternalIdsInErrors: 'passed',
          englishRegeneration: 'passed',
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
