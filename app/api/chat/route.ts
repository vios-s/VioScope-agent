import 'dotenv/config';
import { RequestContext } from '@mastra/core/request-context';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../src/mastra/auth/session';
import { mastra } from '../../../src/mastra';
import { recordAuditLog } from '../../../src/mastra/db/audit-log';
import type { AuthUser } from '../../../src/mastra/db/users';
import {
  saveChatTurn,
  shareChatSessionWithMentions,
  type ChatMentionResult,
} from '../../../src/mastra/db/chat';
import { matchesChatPolicyTerms, vioscopeChatPolicyConfig } from '../../../src/mastra/agents/vioscope.chat-policy.config';
import { searchWiki, shouldExpandWikiQuery } from '../../../src/mastra/tools/wiki-search';
import { loadUserDatastoreContext, type UserDatastoreContext } from '../../../src/mastra/users/datastore';

export const runtime = 'nodejs';

type ChatSource = {
  title: string;
  url: string;
  path?: string;
};

type PreloadedWikiContext = Awaited<ReturnType<typeof searchWiki>>;

type VioScopeRequestContext = {
  'vioscope-user': AuthUser;
};

function positionLabel(position: AuthUser['position']): string | null {
  if (!position) return null;
  if (position === 'pi') return 'PI';
  if (position === 'software_engineer') return 'Software Engineer';
  return position
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

const openAIProviderOptions = {
  openai: {
    store: false,
  },
} as const;

function isZdrItemReferenceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Items are not persisted for Zero Data Retention|Item with id .* not found/i.test(message);
}

function isClearlyOutOfScope(message: string): boolean {
  if (matchesChatPolicyTerms(message, vioscopeChatPolicyConfig.labScopeTerms)) {
    return false;
  }

  return matchesChatPolicyTerms(message, vioscopeChatPolicyConfig.obviousOutOfScopeTerms);
}

function messageWithUserContext(
  message: string,
  user: AuthUser,
  datastore: UserDatastoreContext | null,
  wikiContext: PreloadedWikiContext | null,
): string {
  const profile = user.profile || { researchInterests: [], publicInfo: [] };
  const lines = [
    'Signed-in user context for personalization and disambiguation only:',
    `- Display name: ${user.displayName}`,
    `- Username: ${user.username}`,
    `- VioScope permission role: ${user.role}`,
    '- Permission role is app access, not employment or student status.',
  ];
  const position = positionLabel(user.position);
  if (position) {
    lines.push(`- Position: ${position}`);
  }

  if (user.aliases.length) {
    lines.push(`- Known aliases: ${user.aliases.join(', ')}`);
  }

  if (profile.publicRole) {
    lines.push(`- Public team role/title: ${profile.publicRole}`);
  }
  if (profile.publicGroup) {
    lines.push(`- Public team group: ${profile.publicGroup}`);
  }
  if (profile.researchInterests.length) {
    lines.push(`- Research interests: ${profile.researchInterests.join('; ')}`);
  }
  if (!position && !profile.publicRole) {
    lines.push('- Position/employment/student status is not set in the user profile.');
  }
  if (datastore) {
    lines.push(`- User datastore folder: DATASTORE_DIR/users/${datastore.slug}`);
  }
  if (datastore?.profile) {
    lines.push(`- User datastore profile (${datastore.profile.path}):\n${datastore.profile.text}`);
  }
  if (datastore?.memory) {
    lines.push(`- User datastore memory (${datastore.memory.path}):\n${datastore.memory.text}`);
  }
  if (wikiContext?.relevantContext.length) {
    lines.push(
      'Potential wiki context retrieved for this ambiguous practical/institutional question. Use only if it is relevant; otherwise say the wiki evidence is insufficient.',
    );
    for (const [index, item] of wikiContext.relevantContext.slice(0, 3).entries()) {
      const title = text(item.page_title) || `Wiki result ${index + 1}`;
      const url = text(item.url);
      const path = text(item.page_path);
      const chunkText = text(item.text)?.slice(0, 1800) || '';
      lines.push(`- ${title}${path ? ` (${path})` : ''}${url ? ` ${url}` : ''}:\n${chunkText}`);
    }
  }

  return `${lines.join('\n')}\n\nUser question:\n${message}`;
}

function mergeSources(primary: ChatSource[], fallback: ChatSource[]): ChatSource[] {
  const byUrl = new Map<string, ChatSource>();
  for (const source of [...primary, ...fallback]) {
    if (source.url && !byUrl.has(source.url)) {
      byUrl.set(source.url, source);
    }
  }
  return Array.from(byUrl.values());
}

function extractSources(value: unknown, sources = new Map<string, ChatSource>(), seen = new WeakSet<object>()): ChatSource[] {
  if (!value || typeof value !== 'object') return Array.from(sources.values());
  if (seen.has(value)) return Array.from(sources.values());
  seen.add(value);

  const record = value as Record<string, unknown>;
  const metadata = record.metadata && typeof record.metadata === 'object' ? (record.metadata as Record<string, unknown>) : record;
  const url = text(metadata.url);
  if (url && /^https?:\/\//i.test(url)) {
    sources.set(url, {
      title: text(metadata.page_title) || text(metadata.title) || text(record.title) || 'Source',
      url,
      path: text(metadata.page_path) || text(record.path),
    });
  }

  for (const child of Array.isArray(value) ? value : Object.values(record)) {
    extractSources(child, sources, seen);
  }

  return Array.from(sources.values());
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const message = text(body.message);
    if (!message) {
      throw new Error('message is required.');
    }

    const threadId = text(body.threadId) || `web-${Date.now()}`;
    if (isClearlyOutOfScope(message)) {
      const text = vioscopeChatPolicyConfig.scopeRefusal;
      const mentions = await persistChatAndMentions({
        threadId,
        user,
        message,
        answer: text,
        status: 'refusal',
        sources: [],
      });
      return NextResponse.json({
        threadId,
        text,
        sources: [],
        mentions,
        finishReason: 'scope_refusal',
        toolCalls: [],
        toolResults: [],
      });
    }

    const agent = mastra.getAgent('vioscopeAgent');
    const userDatastoreContext = await loadUserDatastoreContext(user);
    const preloadedWikiContext = shouldExpandWikiQuery(message) ? await searchWiki(message, 5) : null;
    const agentMessage = messageWithUserContext(message, user, userDatastoreContext, preloadedWikiContext);
    const requestContext = new RequestContext<VioScopeRequestContext>();
    requestContext.set('vioscope-user', user);
    let response: Awaited<ReturnType<typeof agent.generate>>;
    let responseThreadId = threadId;

    try {
      response = await agent.generate(agentMessage, {
        maxSteps: 5,
        providerOptions: openAIProviderOptions,
        requestContext,
        memory: {
          thread: threadId,
          resource: user.id,
        },
      });
    } catch (error) {
      if (!isZdrItemReferenceError(error)) {
        throw error;
      }

      responseThreadId = `web-${Date.now()}`;
      response = await agent.generate(agentMessage, {
        maxSteps: 5,
        providerOptions: openAIProviderOptions,
        requestContext,
      });
    }

    const sources = mergeSources(extractSources(response.toolResults || []), preloadedWikiContext?.sources || []);
    const mentions = await persistChatAndMentions({
      threadId: responseThreadId,
      user,
      message,
      answer: response.text,
      status: refusalPattern.test(response.text) ? 'refusal' : 'answer',
      sources,
    });

    return NextResponse.json({
      threadId: responseThreadId,
      text: response.text,
      sources,
      mentions,
      finishReason: response.finishReason,
      toolCalls: response.toolCalls || [],
      toolResults: response.toolResults || [],
    });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}

const refusalPattern = /cannot help|could not complete|not covered|don't have enough|out of scope/i;

async function persistChatAndMentions(input: {
  threadId: string;
  user: AuthUser;
  message: string;
  answer: string;
  status: 'answer' | 'refusal';
  sources: ChatSource[];
}): Promise<ChatMentionResult> {
  await saveChatTurn({
    sessionId: input.threadId,
    actor: input.user,
    userText: input.message,
    assistantText: input.answer,
    assistantStatus: input.status,
    sources: input.sources,
  });
  const mentions = await shareChatSessionWithMentions({
    sessionId: input.threadId,
    actor: input.user,
    message: input.message,
  });
  await recordAuditLog({
    actor: input.user,
    action: 'chat.turn',
    targetType: 'chat_session',
    targetId: input.threadId,
    summary: 'User sent chat message.',
    metadata: {
      status: input.status,
      messageLength: input.message.length,
      sourceCount: input.sources.length,
      sharedCount: mentions.shared.length,
      unknownMentionCount: mentions.unknown.length,
    },
  });
  return mentions;
}
