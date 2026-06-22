import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../../src/mastra/auth/session';
import { importLocalChatSessions, type ChatSourceRecord, type ImportedChatSession } from '../../../../src/mastra/db/chat';

export const runtime = 'nodejs';

function text(value: unknown, max = 4000): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

function cleanSources(value: unknown): ChatSourceRecord[] {
  if (!Array.isArray(value)) return [];
  const sources: ChatSourceRecord[] = [];
  for (const source of value.slice(0, 20)) {
    if (!source || typeof source !== 'object') continue;
    const record = source as Record<string, unknown>;
    const title = text(record.title, 200);
    const url = text(record.url, 1000);
    if (!title || !url) continue;
    const path = text(record.path, 1000);
    sources.push(path ? { title, url, path } : { title, url });
  }
  return sources;
}

function cleanSessions(value: unknown): ImportedChatSession[] {
  if (!Array.isArray(value)) return [];
  const sessions: ImportedChatSession[] = [];

  for (const session of value.slice(0, 20)) {
    if (!session || typeof session !== 'object') continue;
    const record = session as Record<string, unknown>;
    const threadId = text(record.threadId, 200);
    const rawMessages = Array.isArray(record.messages) ? record.messages : [];
    const messages: ImportedChatSession['messages'] = [];

    for (const message of rawMessages.slice(0, 200)) {
      if (!message || typeof message !== 'object') continue;
      const messageRecord = message as Record<string, unknown>;
      const role = messageRecord.role === 'user' || messageRecord.role === 'assistant' ? messageRecord.role : null;
      const content = text(messageRecord.text);
      if (!role || !content) continue;
      messages.push({
        role,
        text: content,
        status: messageRecord.status === 'refusal' ? 'refusal' : 'answer',
        sources: cleanSources(messageRecord.sources),
        createdAt: text(messageRecord.createdAt, 80),
      });
    }

    if (!threadId || !messages.length) continue;
    sessions.push({
      threadId,
      title: text(record.title, 200) || messages[0].text.slice(0, 72) || 'New chat',
      updatedAt: text(record.updatedAt, 80),
      messages,
    });
  }

  return sessions;
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const sessions = cleanSessions(body.sessions);
    const imported = await importLocalChatSessions({ actor: user, sessions });
    return NextResponse.json({ imported });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
