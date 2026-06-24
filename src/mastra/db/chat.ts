import { createPostgresClient } from './postgres';
import { ensureUsersTable, normalizeNotificationPreferences, type AuthUser, type NotificationPreferences } from './users';

export type ChatSourceRecord = {
  title: string;
  url: string;
  path?: string;
};

export type ChatMessageRecord = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  actorUserId?: string;
  actorUsername?: string;
  actorDisplayName?: string;
  actorAvatarUrl?: string;
  status?: 'answer' | 'refusal';
  sources?: ChatSourceRecord[];
  createdAt: string;
};

export type ChatSessionRecord = {
  threadId: string;
  title: string;
  ownerUserId: string;
  ownerUsername: string;
  ownerDisplayName: string;
  membershipKind: 'owner' | 'shared';
  sharedByUserId: string | null;
  sharedByDisplayName: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessageRecord[];
};

export type MentionableUser = Pick<AuthUser, 'id' | 'username' | 'displayName' | 'role'>;

export type ChatMentionResult = {
  shared: MentionableUser[];
  unknown: string[];
};

export type ChatNotificationRecord = {
  id: string;
  type: 'chat_mention';
  title: string;
  body: string;
  sessionId: string;
  actorUserId: string;
  actorUsername: string;
  actorDisplayName: string;
  readAt: string | null;
  createdAt: string;
};

export type ImportedChatSession = {
  threadId: string;
  title: string;
  updatedAt?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    text: string;
    status?: 'answer' | 'refusal';
    sources?: ChatSourceRecord[];
    createdAt?: string;
  }>;
};

type SessionRow = {
  id: string;
  title: string;
  owner_user_id: string;
  owner_username: string;
  owner_display_name: string;
  membership_kind: 'owner' | 'shared';
  shared_by_user_id: string | null;
  shared_by_display_name: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  actor_user_id: string | null;
  actor_username: string | null;
  actor_display_name: string | null;
  actor_avatar_url: string | null;
  status: 'answer' | 'refusal' | null;
  sources: ChatSourceRecord[] | string | null;
  created_at: string;
};

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  role: AuthUser['role'];
  metadata?: Record<string, unknown> | string | null;
};

type MentionRecipient = MentionableUser & {
  notificationPreferences: NotificationPreferences;
};

type NotificationRow = {
  id: string;
  type: 'chat_mention';
  title: string;
  body: string;
  session_id: string;
  actor_user_id: string;
  actor_username: string;
  actor_display_name: string;
  read_at: string | null;
  created_at: string;
};

let ensureChatTablesPromise: Promise<void> | null = null;

function titleFromMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, 72) || 'New chat';
}

function snippet(message: string): string {
  const clean = message.replace(/\s+/g, ' ').trim();
  return clean.length > 180 ? `${clean.slice(0, 177)}...` : clean;
}

function validDate(value?: string): string {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

function sourcesFromDb(value: MessageRow['sources']): ChatSourceRecord[] {
  if (!value) return [];
  if (typeof value !== 'string') return Array.isArray(value) ? value : [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatSourceRecord[]) : [];
  } catch {
    return [];
  }
}

function toMessage(row: MessageRow): ChatMessageRecord {
  return {
    id: row.id,
    role: row.role,
    text: row.content,
    actorUserId: row.actor_user_id || undefined,
    actorUsername: row.actor_username || undefined,
    actorDisplayName: row.actor_display_name || undefined,
    actorAvatarUrl: row.actor_avatar_url || undefined,
    status: row.status || undefined,
    sources: sourcesFromDb(row.sources),
    createdAt: row.created_at,
  };
}

function toNotification(row: NotificationRow): ChatNotificationRecord {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    sessionId: row.session_id,
    actorUserId: row.actor_user_id,
    actorUsername: row.actor_username,
    actorDisplayName: row.actor_display_name,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

function notificationPreferencesFromUserMetadata(metadata: UserRow['metadata']): NotificationPreferences {
  if (!metadata) return normalizeNotificationPreferences(undefined);
  if (typeof metadata === 'string') {
    try {
      return normalizeNotificationPreferences((JSON.parse(metadata) as Record<string, unknown>).notification_preferences);
    } catch {
      return normalizeNotificationPreferences(undefined);
    }
  }
  return normalizeNotificationPreferences(metadata.notification_preferences);
}

async function ensureChatTablesOnce(): Promise<void> {
  await ensureUsersTable();
  const postgres = createPostgresClient('vioscope-chat');

  try {
    await postgres.pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await postgres.pool.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT 'New chat',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await postgres.pool.query(`
      CREATE TABLE IF NOT EXISTS chat_session_members (
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        shared_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        membership_kind TEXT NOT NULL DEFAULT 'shared' CHECK (membership_kind IN ('owner', 'shared')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (session_id, user_id)
      )
    `);
    await postgres.pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        status TEXT CHECK (status IN ('answer', 'refusal')),
        sources JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await postgres.pool.query(`
      CREATE TABLE IF NOT EXISTS chat_notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'chat_mention' CHECK (type IN ('chat_mention')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS chat_sessions_updated_at_idx ON chat_sessions (updated_at DESC)');
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS chat_session_members_user_idx ON chat_session_members (user_id)');
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages (session_id, created_at)');
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS chat_notifications_recipient_idx ON chat_notifications (recipient_user_id, created_at DESC)');
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS chat_notifications_unread_idx ON chat_notifications (recipient_user_id) WHERE read_at IS NULL');
  } finally {
    await postgres.disconnect();
  }
}

export async function ensureChatTables(): Promise<void> {
  ensureChatTablesPromise ||= ensureChatTablesOnce().catch((error) => {
    ensureChatTablesPromise = null;
    throw error;
  });
  return ensureChatTablesPromise;
}

export function parseMentionUsernames(message: string): string[] {
  const mentions = new Set<string>();
  const pattern = /(^|[^a-z0-9._-])@([a-z0-9][a-z0-9._-]{1,62}[a-z0-9])\b/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(message))) {
    mentions.add(match[2].toLowerCase());
  }

  return [...mentions];
}

export async function listMentionableUsers(): Promise<MentionableUser[]> {
  await ensureChatTables();
  const postgres = createPostgresClient('vioscope-chat');

  try {
    const result = await postgres.pool.query<UserRow>(
      `
        SELECT id::text, username, display_name, role
        FROM users
        WHERE provisioning_status = 'active'
        ORDER BY display_name, username
      `,
    );
    const rows = result.rows as UserRow[];
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
    }));
  } finally {
    await postgres.disconnect();
  }
}

export async function saveChatTurn(input: {
  sessionId: string;
  actor: AuthUser;
  userText: string;
  assistantText: string;
  assistantStatus: 'answer' | 'refusal';
  sources: ChatSourceRecord[];
}): Promise<void> {
  await ensureChatTables();
  const postgres = createPostgresClient('vioscope-chat');
  const title = titleFromMessage(input.userText);

  try {
    await postgres.pool.query('BEGIN');
    const sessionResult = await postgres.pool.query<{ owner_user_id: string }>(
      'SELECT owner_user_id::text FROM chat_sessions WHERE id = $1',
      [input.sessionId],
    );
    const existingSession = sessionResult.rows[0];

    if (existingSession) {
      const memberResult = await postgres.pool.query(
        'SELECT 1 FROM chat_session_members WHERE session_id = $1 AND user_id = $2',
        [input.sessionId, input.actor.id],
      );
      if (!memberResult.rowCount) {
        throw new Error('You do not have access to this chat session.');
      }
      await postgres.pool.query(
        `
          UPDATE chat_sessions
          SET title = CASE WHEN title = 'New chat' THEN $2 ELSE title END, updated_at = now()
          WHERE id = $1
        `,
        [input.sessionId, title],
      );
    } else {
      await postgres.pool.query(
        'INSERT INTO chat_sessions (id, owner_user_id, title) VALUES ($1, $2, $3)',
        [input.sessionId, input.actor.id, title],
      );
      await postgres.pool.query(
        `
          INSERT INTO chat_session_members (session_id, user_id, membership_kind)
          VALUES ($1, $2, 'owner')
          ON CONFLICT (session_id, user_id) DO NOTHING
        `,
        [input.sessionId, input.actor.id],
      );
    }

    await postgres.pool.query(
      `
        INSERT INTO chat_messages (session_id, role, content, actor_user_id)
        VALUES ($1, 'user', $2, $3)
      `,
      [input.sessionId, input.userText, input.actor.id],
    );
    await postgres.pool.query(
      `
        INSERT INTO chat_messages (session_id, role, content, status, sources)
        VALUES ($1, 'assistant', $2, $3, $4::jsonb)
      `,
      [input.sessionId, input.assistantText, input.assistantStatus, JSON.stringify(input.sources)],
    );
    await postgres.pool.query('UPDATE chat_sessions SET updated_at = now() WHERE id = $1', [input.sessionId]);
    await postgres.pool.query('COMMIT');
  } catch (error) {
    await postgres.pool.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await postgres.disconnect();
  }
}

export async function importLocalChatSessions(input: {
  actor: AuthUser;
  sessions: ImportedChatSession[];
}): Promise<number> {
  if (!input.sessions.length) {
    return 0;
  }

  await ensureChatTables();
  const postgres = createPostgresClient('vioscope-chat');
  let imported = 0;

  try {
    await postgres.pool.query('BEGIN');

    for (const session of input.sessions.slice(0, 20)) {
      const sessionId = `legacy-${input.actor.id}-${session.threadId}`;
      const messages = session.messages.slice(0, 200);
      if (!messages.length) continue;

      const inserted = await postgres.pool.query(
        `
          INSERT INTO chat_sessions (id, owner_user_id, title, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $4)
          ON CONFLICT (id) DO NOTHING
        `,
        [sessionId, input.actor.id, session.title || titleFromMessage(messages[0].text), validDate(session.updatedAt)],
      );

      await postgres.pool.query(
        `
          INSERT INTO chat_session_members (session_id, user_id, membership_kind)
          VALUES ($1, $2, 'owner')
          ON CONFLICT (session_id, user_id) DO NOTHING
        `,
        [sessionId, input.actor.id],
      );

      if (!inserted.rowCount) continue;
      imported += 1;

      for (const message of messages) {
        await postgres.pool.query(
          `
            INSERT INTO chat_messages (session_id, role, content, actor_user_id, status, sources, created_at)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
          `,
          [
            sessionId,
            message.role,
            message.text,
            message.role === 'user' ? input.actor.id : null,
            message.role === 'assistant' ? message.status || 'answer' : null,
            JSON.stringify(message.sources || []),
            validDate(message.createdAt || session.updatedAt),
          ],
        );
      }
    }

    await postgres.pool.query('COMMIT');
    return imported;
  } catch (error) {
    await postgres.pool.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await postgres.disconnect();
  }
}

export async function shareChatSessionWithMentions(input: {
  sessionId: string;
  actor: AuthUser;
  message: string;
}): Promise<ChatMentionResult> {
  const usernames = parseMentionUsernames(input.message);
  if (!usernames.length) {
    return { shared: [], unknown: [] };
  }

  await ensureChatTables();
  const postgres = createPostgresClient('vioscope-chat');

  try {
    const userResult = await postgres.pool.query<UserRow>(
      `
        SELECT id::text, username, display_name, role, metadata
        FROM users
        WHERE provisioning_status = 'active'
          AND username = ANY($1::text[])
      `,
      [usernames],
    );
    const userRows = userResult.rows as UserRow[];
    const found: MentionRecipient[] = userRows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      notificationPreferences: notificationPreferencesFromUserMetadata(row.metadata),
    }));
    const foundNames = new Set(found.map((user) => user.username));
    const unknown = usernames.filter((username) => !foundNames.has(username));
    const recipients = found.filter((user) => user.id !== input.actor.id);

    if (!recipients.length) {
      return { shared: [], unknown };
    }

    await postgres.pool.query('BEGIN');
    const sessionResult = await postgres.pool.query<{ title: string }>(
      `
        SELECT s.title
        FROM chat_sessions s
        JOIN chat_session_members m ON m.session_id = s.id
        WHERE s.id = $1 AND m.user_id = $2
      `,
      [input.sessionId, input.actor.id],
    );
    const session = sessionResult.rows[0];
    if (!session) {
      throw new Error('You do not have access to this chat session.');
    }

    for (const recipient of recipients) {
      const title = `${input.actor.displayName} mentioned you in "${session.title}"`;
      const body = snippet(input.message);
      await postgres.pool.query(
        `
          INSERT INTO chat_session_members (session_id, user_id, shared_by_user_id, membership_kind)
          VALUES ($1, $2, $3, 'shared')
          ON CONFLICT (session_id, user_id) DO NOTHING
        `,
        [input.sessionId, recipient.id, input.actor.id],
      );
      if (recipient.notificationPreferences.chat_mentions.web) {
        await postgres.pool.query(
          `
            INSERT INTO chat_notifications (recipient_user_id, actor_user_id, title, body, session_id)
            VALUES ($1, $2, $3, $4, $5)
          `,
          [recipient.id, input.actor.id, title, body, input.sessionId],
        );
      }
    }

    await postgres.pool.query('COMMIT');
    return { shared: recipients, unknown };
  } catch (error) {
    await postgres.pool.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await postgres.disconnect();
  }
}

export async function listChatSessionsForUser(userId: string): Promise<ChatSessionRecord[]> {
  await ensureChatTables();
  const postgres = createPostgresClient('vioscope-chat');

  try {
    const sessionResult = await postgres.pool.query<SessionRow>(
      `
        SELECT
          s.id,
          s.title,
          s.owner_user_id::text,
          owner.username AS owner_username,
          owner.display_name AS owner_display_name,
          m.membership_kind,
          m.shared_by_user_id::text,
          sharer.display_name AS shared_by_display_name,
          s.created_at::text,
          s.updated_at::text
        FROM chat_session_members m
        JOIN chat_sessions s ON s.id = m.session_id
        JOIN users owner ON owner.id = s.owner_user_id
        LEFT JOIN users sharer ON sharer.id = m.shared_by_user_id
        WHERE m.user_id = $1
        ORDER BY s.updated_at DESC
        LIMIT 50
      `,
      [userId],
    );
    const sessionRows = sessionResult.rows as SessionRow[];
    const sessionIds = sessionRows.map((row) => row.id);
    if (!sessionIds.length) {
      return [];
    }

    const messageResult = await postgres.pool.query<MessageRow>(
      `
        SELECT
          msg.id::text,
          msg.session_id,
          msg.role,
          msg.content,
          msg.actor_user_id::text,
          actor.username AS actor_username,
          actor.display_name AS actor_display_name,
          actor.metadata->>'avatar_url' AS actor_avatar_url,
          msg.status,
          msg.sources,
          msg.created_at::text
        FROM chat_messages msg
        LEFT JOIN users actor ON actor.id = msg.actor_user_id
        WHERE msg.session_id = ANY($1::text[])
        ORDER BY msg.created_at ASC
      `,
      [sessionIds],
    );
    const messagesBySession = new Map<string, ChatMessageRecord[]>();
    for (const row of messageResult.rows as MessageRow[]) {
      const messages = messagesBySession.get(row.session_id) || [];
      messages.push(toMessage(row));
      messagesBySession.set(row.session_id, messages);
    }

    return sessionRows.map((row) => ({
      threadId: row.id,
      title: row.title,
      ownerUserId: row.owner_user_id,
      ownerUsername: row.owner_username,
      ownerDisplayName: row.owner_display_name,
      membershipKind: row.membership_kind,
      sharedByUserId: row.shared_by_user_id,
      sharedByDisplayName: row.shared_by_display_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: messagesBySession.get(row.id) || [],
    }));
  } finally {
    await postgres.disconnect();
  }
}

export async function deleteChatSessionForUser(input: { sessionId: string; userId: string }): Promise<'deleted' | 'removed'> {
  await ensureChatTables();
  const postgres = createPostgresClient('vioscope-chat');

  try {
    await postgres.pool.query('BEGIN');
    const sessionResult = await postgres.pool.query<{ owner_user_id: string; membership_kind: 'owner' | 'shared' }>(
      `
        SELECT s.owner_user_id::text, m.membership_kind
        FROM chat_sessions s
        JOIN chat_session_members m ON m.session_id = s.id
        WHERE s.id = $1 AND m.user_id = $2
      `,
      [input.sessionId, input.userId],
    );
    const session = sessionResult.rows[0];
    if (!session) {
      throw new Error('Chat session not found.');
    }

    if (session.owner_user_id === input.userId || session.membership_kind === 'owner') {
      await postgres.pool.query('DELETE FROM chat_sessions WHERE id = $1 AND owner_user_id = $2', [input.sessionId, input.userId]);
      await postgres.pool.query('COMMIT');
      return 'deleted';
    }

    await postgres.pool.query('DELETE FROM chat_session_members WHERE session_id = $1 AND user_id = $2', [input.sessionId, input.userId]);
    await postgres.pool.query('DELETE FROM chat_notifications WHERE session_id = $1 AND recipient_user_id = $2', [input.sessionId, input.userId]);
    await postgres.pool.query('COMMIT');
    return 'removed';
  } catch (error) {
    await postgres.pool.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await postgres.disconnect();
  }
}

export async function renameChatSessionForUser(input: { sessionId: string; userId: string; title: string }): Promise<ChatSessionRecord> {
  const title = input.title.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!title) {
    throw new Error('Session title is required.');
  }

  await ensureChatTables();
  const postgres = createPostgresClient('vioscope-chat');

  try {
    const result = await postgres.pool.query<{ id: string }>(
      `
        UPDATE chat_sessions
        SET title = $3, updated_at = now()
        WHERE id = $1 AND owner_user_id = $2
        RETURNING id
      `,
      [input.sessionId, input.userId, title],
    );
    if (!result.rowCount) {
      throw new Error('Only the owner can rename this chat session.');
    }
  } finally {
    await postgres.disconnect();
  }

  const sessions = await listChatSessionsForUser(input.userId);
  const session = sessions.find((candidate) => candidate.threadId === input.sessionId);
  if (!session) {
    throw new Error('Chat session not found.');
  }
  return session;
}

export async function listChatNotificationsForUser(userId: string): Promise<ChatNotificationRecord[]> {
  await ensureChatTables();
  const postgres = createPostgresClient('vioscope-chat');

  try {
    const result = await postgres.pool.query<NotificationRow>(
      `
        SELECT
          n.id::text,
          n.type,
          n.title,
          n.body,
          n.session_id,
          n.actor_user_id::text,
          actor.username AS actor_username,
          actor.display_name AS actor_display_name,
          n.read_at::text,
          n.created_at::text
        FROM chat_notifications n
        JOIN users actor ON actor.id = n.actor_user_id
        WHERE n.recipient_user_id = $1
        ORDER BY n.created_at DESC
        LIMIT 100
      `,
      [userId],
    );
    return result.rows.map(toNotification);
  } finally {
    await postgres.disconnect();
  }
}

export async function markChatNotificationsRead(input: {
  userId: string;
  notificationId?: string;
  all?: boolean;
}): Promise<ChatNotificationRecord[]> {
  await ensureChatTables();
  const postgres = createPostgresClient('vioscope-chat');

  try {
    if (input.all) {
      await postgres.pool.query(
        'UPDATE chat_notifications SET read_at = COALESCE(read_at, now()) WHERE recipient_user_id = $1',
        [input.userId],
      );
    } else if (input.notificationId) {
      await postgres.pool.query(
        `
          UPDATE chat_notifications
          SET read_at = COALESCE(read_at, now())
          WHERE recipient_user_id = $1 AND id = $2
        `,
        [input.userId, input.notificationId],
      );
    }

    return listChatNotificationsForUser(input.userId);
  } finally {
    await postgres.disconnect();
  }
}
