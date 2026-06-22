'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertCircle,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardList,
  FileText,
  History,
  KeyRound,
  LayoutDashboard,
  LogIn,
  LogOut,
  MessageCircle,
  Moon,
  MoreVertical,
  Pencil,
  Plus,
  Power,
  Save,
  Search,
  Send,
  ShieldCheck,
  Settings,
  Sun,
  Upload,
  X,
  Users,
} from 'lucide-react';
import { DotMatrixIcon } from './dot-matrix-icon';
import { ReviewForm } from './review-form';
import type {
  DerivedLabState,
  DerivedLabStateProject,
  LabStateSummary,
  ProjectRecommendation,
  ProjectStatus,
} from '../src/mastra/state/schema';
import type {
  ThemeMeetingNotification,
  ThemeMeetingPlan,
  ThemeUpdateType,
} from '../src/mastra/theme-meetings/schema';

type ActiveView = 'dashboard' | 'chat' | 'meeting' | 'checklists' | 'alerts' | 'users';
type DashboardMode = 'member' | 'pi';
type ChatMessageStatus = 'thinking' | 'answer' | 'refusal';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status?: ChatMessageStatus;
  sources?: ChatSource[];
  createdAt?: string;
};

type ChatSource = {
  title: string;
  url: string;
  path?: string;
};

type ChatSession = {
  threadId: string;
  title: string;
  updatedAt: string;
  createdAt?: string;
  ownerUserId?: string;
  ownerUsername?: string;
  ownerDisplayName?: string;
  membershipKind?: 'owner' | 'shared';
  sharedByUserId?: string | null;
  sharedByDisplayName?: string | null;
  messages: ChatMessage[];
};

type ChatHistoryMode = 'owned' | 'shared';

type MentionableUser = Pick<CurrentUser, 'id' | 'username' | 'displayName' | 'role'>;

type ChatMentionResult = {
  shared: MentionableUser[];
  unknown: string[];
};

type ChatNotification = {
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

type ChatSessionsPayload = {
  sessions?: ChatSession[];
  error?: string;
};

type MentionUsersPayload = {
  users?: MentionableUser[];
  error?: string;
};

type NotificationsPayload = {
  notifications?: ChatNotification[];
  error?: string;
};

type LabStatePayload = {
  state: DerivedLabState;
  summary: LabStateSummary;
  source: 'configured' | 'fixture';
  warning?: string;
};

type ThemeMeetingPayload = {
  plan: ThemeMeetingPlan;
  notifications: ThemeMeetingNotification[];
  access?: {
    canManageThemeIds: string[];
  };
  users?: ThemeUserOption[];
  source: 'configured' | 'fixture';
};

type ThemeUserOption = Pick<ManagedUser, 'id' | 'username' | 'displayName' | 'role' | 'provisioningStatus'>;

type CurrentUser = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: 'administrator' | 'pi' | 'organizer' | 'member' | 'viewer' | 'service';
  provisioningStatus: string;
  sourceProfileId: string | null;
  aliases: string[];
  profile?: {
    email?: string;
    avatarUrl?: string;
    publicRole?: string;
    publicGroup?: string;
    researchInterests: string[];
    publicInfo: string[];
  };
  passwordResetRequired: boolean;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
};

type ManagedUser = CurrentUser & {
  source: string;
  hasPassword: boolean;
};

type UserDraft = {
  displayName: string;
  email: string;
  avatarUrl: string;
  role: CurrentUser['role'];
  provisioningStatus: CurrentUser['provisioningStatus'];
  aliasesText: string;
  temporaryPassword: string;
};

type AuthPayload = {
  user?: CurrentUser;
  error?: string;
};

type UsersPayload = {
  users?: ManagedUser[];
  user?: ManagedUser;
  error?: string;
};

type AuditLogRecord = {
  id: string;
  eventTime: string;
  eventDay: string;
  actorUsername: string | null;
  actorRole: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
};

type AuditLogDay = {
  day: string;
  fileName: string;
  count: number;
};

type AuditLogPayload = {
  day?: string;
  fileName?: string;
  logs?: AuditLogRecord[];
  days?: AuditLogDay[];
  error?: string;
};

type AdminConfigSetting = {
  key: string;
  label: string;
  section: 'model' | 'rag' | 'paths' | 'submission' | 'operations';
  valueType: 'string' | 'number' | 'path';
  value: string;
  defaultValue: string;
  source: 'database' | 'env' | 'default';
  storedValue: string | null;
  description: string;
  restartRequired: boolean;
  optional?: boolean;
  status?: {
    state: 'ok' | 'missing' | 'not_configured';
    detail: string;
  };
};

type AdminConfigPayload = {
  settings?: AdminConfigSetting[];
  secrets?: Array<{ key: string; label: string; configured: boolean }>;
  restart?: { configured: boolean };
  error?: string;
};

type ConsoleTheme = 'light' | 'dark' | 'system';
type SettingsTab = 'general' | 'notifications' | 'integrations' | 'users' | 'config' | 'audit' | 'about';
type PasswordStrength = 'weak' | 'medium' | 'strong';
type ChecklistTemplateId = 'idea' | 'skeleton' | 'pdra' | 'red';
type ChecklistTag = 'Core' | 'Required' | 'Advisory';

type ChecklistTemplate = {
  id: ChecklistTemplateId;
  label: string;
  shortLabel: string;
  version: string;
  status: 'preview' | 'available';
  description: string;
  items: Array<{
    title: string;
    detail: string;
    tag: ChecklistTag;
  }>;
};

const statusLabels: Record<ProjectStatus, string> = {
  on_track: 'On track',
  blocked: 'Blocked',
  stale: 'Stale',
  needs_input: 'Needs input',
};

const recommendationLabels: Record<ProjectRecommendation, string> = {
  deep_dive: 'Deep dive',
  nudge: 'Nudge',
  none: 'None',
};

const updateTypeLabels: Record<ThemeUpdateType, string> = {
  nothing_to_report: 'Nothing to report',
  short_update: 'Short update',
  deep_dive: 'Deep dive',
};

const signalLabels: Record<string, string> = {
  blocked_status: 'blocked',
  blocker_present: 'blocker present',
  needs_input_status: 'needs input',
  stale_status: 'marked stale',
  no_recent_update: 'no recent update',
  long_time_in_stage: 'long time in stage',
  missing_last_update: 'missing last update',
  missing_stage_since: 'missing stage date',
};

const prompts = [
  "What's our standard chunking strategy for the RAG pipeline?",
  'Who needs a nudge before the next theme meeting?',
  'What should I check before running Skeleton Lock?',
  "What's the GPU quota policy on EIDF?",
];

const checklistTemplates: ChecklistTemplate[] = [
  {
    id: 'idea',
    label: 'Idea Pitch',
    shortLabel: 'Idea Pitch',
    version: '2.1',
    status: 'preview',
    description: 'Sanity-checks a new project idea before it goes to a theme meeting: novelty, feasibility, and fit with lab tracks.',
    items: [
      { title: 'Problem clearly framed', detail: 'One-sentence problem statement a non-specialist can follow.', tag: 'Core' },
      { title: 'Novelty vs prior work', detail: "How this differs from the lab's existing projects and key external work.", tag: 'Core' },
      { title: 'Feasibility in 6 months', detail: 'Realistic given equipment, participants, and personnel.', tag: 'Core' },
      { title: 'Track fit', detail: 'Maps to an existing lab track or justifies a new one.', tag: 'Advisory' },
      { title: 'Ethics flag raised early', detail: 'Human-subjects or data-sensitivity concerns are noted up front.', tag: 'Required' },
    ],
  },
  {
    id: 'skeleton',
    label: 'Skeleton Lock',
    shortLabel: 'Skeleton Lock',
    version: '1.4',
    status: 'available',
    description: 'Confirms the paper skeleton is locked before writing: structure, claims, figures, and method are in place.',
    items: [
      { title: 'Section structure complete', detail: 'All sections present with one-line intent each.', tag: 'Core' },
      { title: 'Central claim stated', detail: 'The single contribution the paper defends.', tag: 'Core' },
      { title: 'Figures planned', detail: 'Each results figure has a placeholder and caption stub.', tag: 'Core' },
      { title: 'Method matches claim', detail: 'Analysis plan actually tests the stated claim.', tag: 'Required' },
      { title: 'Author order agreed', detail: 'Contributions logged and order signed off.', tag: 'Advisory' },
    ],
  },
  {
    id: 'pdra',
    label: 'PDRA Meta-Review',
    shortLabel: 'PDRA',
    version: '3.0',
    status: 'available',
    description: 'A senior post-doc style meta-review pass over a near-final draft: rigour, framing, and reviewer-readiness.',
    items: [
      { title: 'Claims supported by evidence', detail: 'Every claim traces to a result or citation.', tag: 'Core' },
      { title: 'Stats reported correctly', detail: 'Effect sizes, CIs, and corrections present.', tag: 'Required' },
      { title: 'Limitations honest', detail: 'Threats to validity acknowledged, not buried.', tag: 'Core' },
      { title: 'Related work fair', detail: 'Key competing work cited and represented fairly.', tag: 'Core' },
      { title: 'Reproducibility package', detail: 'Code, data, and seeds referenced.', tag: 'Required' },
    ],
  },
  {
    id: 'red',
    label: 'Red-Team',
    shortLabel: 'Red-Team',
    version: '1.2',
    status: 'available',
    description: 'An adversarial pass that surfaces where a hostile reviewer could attack before submission.',
    items: [
      { title: 'Strongest counter-argument', detail: 'The single best reason to reject, stated plainly.', tag: 'Core' },
      { title: 'Confound check', detail: 'Alternative explanations for the main result ruled out.', tag: 'Required' },
      { title: 'Overclaiming scan', detail: 'Language tightened where evidence is thin.', tag: 'Core' },
      { title: 'Generalisability limits', detail: 'Scope of claims matches the sample.', tag: 'Core' },
      { title: 'Ethics and dual-use', detail: 'Potential for misuse considered.', tag: 'Advisory' },
    ],
  },
];

const userRoleOptions: CurrentUser['role'][] = ['administrator', 'pi', 'organizer', 'member', 'viewer', 'service'];
const provisioningStatusOptions = ['profile_only', 'invited', 'active', 'disabled'];
const refusalPattern = /could not find|cannot find|not enough|insufficient|knowledge gap|limited to VIOS lab|non-lab topics/i;
const activeViews: ActiveView[] = ['dashboard', 'chat', 'meeting', 'checklists', 'alerts', 'users'];
const viewQueryParam = 'view';

function activeViewFromSearch(search: string): ActiveView {
  const view = new URLSearchParams(search).get(viewQueryParam);
  return activeViews.includes(view as ActiveView) ? (view as ActiveView) : 'dashboard';
}

function writeViewToUrl(view: ActiveView, replace = false) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set(viewQueryParam, view);
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history[replace ? 'replaceState' : 'pushState']({}, '', nextUrl);
  }
}

function titleCase(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDate(value: string | null) {
  if (!value) return 'No date';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00Z`));
}

function formatAge(days: number | null) {
  if (days === null) return 'unknown';
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function canSeeAllRole(role: CurrentUser['role']) {
  return role === 'administrator' || role === 'pi';
}

function normalizedName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function chatMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function chatHistoryKey(userId: string) {
  return `vioscope.chat.sessions.${userId}`;
}

function chatHistoryImportKey(userId: string) {
  return `${chatHistoryKey(userId)}.serverImported`;
}

function loadChatSessions(userId: string): ChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = window.localStorage.getItem(chatHistoryKey(userId));
    if (!value) return [];
    const sessions = JSON.parse(value) as ChatSession[];
    return Array.isArray(sessions) ? sessions.filter((session) => session.threadId && Array.isArray(session.messages)) : [];
  } catch {
    return [];
  }
}

function saveChatSessions(userId: string, sessions: ChatSession[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(chatHistoryKey(userId), JSON.stringify(sessions.slice(0, 20)));
}

async function importLocalChatSessionsOnce(userId: string): Promise<number> {
  if (typeof window === 'undefined') return 0;
  const importKey = chatHistoryImportKey(userId);
  if (window.localStorage.getItem(importKey)) return 0;
  const sessions = loadChatSessions(userId);
  if (!sessions.length) {
    window.localStorage.setItem(importKey, new Date().toISOString());
    return 0;
  }

  const response = await fetch('/api/chat/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessions }),
  });
  const body = (await response.json()) as { imported?: number; error?: string };
  if (!response.ok) {
    throw new Error(body.error || 'Could not import local chat history.');
  }
  window.localStorage.setItem(importKey, new Date().toISOString());
  return body.imported || 0;
}

function chatSessionTitle(messages: ChatMessage[]) {
  return messages.find((message) => message.role === 'user')?.text.slice(0, 72) || 'New chat';
}

function chatSessionTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function compactJson(value: Record<string, unknown>) {
  const text = JSON.stringify(value);
  return text.length > 72 ? `${text.slice(0, 72)}...` : text;
}

function auditLogJson(log: AuditLogRecord) {
  return JSON.stringify({
    id: log.id,
    eventTime: log.eventTime,
    eventDay: log.eventDay,
    actorUsername: log.actorUsername,
    actorRole: log.actorRole,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    summary: log.summary,
    metadata: log.metadata,
  }, null, 2);
}

function highlightedJson(json: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /("(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)/g;
  let lastIndex = 0;
  let tokenIndex = 0;

  for (const match of json.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(json.slice(lastIndex, index));
    }
    const token = match[0];
    const isKey = token.startsWith('"') && /^\s*:/.test(json.slice(index + token.length));
    const className = isKey
      ? 'json-key'
      : token.startsWith('"')
        ? 'json-string'
        : token === 'true' || token === 'false'
          ? 'json-boolean'
          : token === 'null'
            ? 'json-null'
            : 'json-number';
    nodes.push(<span className={className} key={`json-${tokenIndex}`}>{token}</span>);
    lastIndex = index + token.length;
    tokenIndex += 1;
  }

  if (lastIndex < json.length) {
    nodes.push(json.slice(lastIndex));
  }
  return nodes;
}

function auditMonthLabel(monthKey: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(`${monthKey}-01T00:00:00Z`));
}

function groupedAuditDays(days: AuditLogDay[]) {
  const groups = new Map<string, AuditLogDay[]>();
  for (const logDay of days) {
    const key = logDay.day.slice(0, 7);
    groups.set(key, [...(groups.get(key) || []), logDay]);
  }
  return Array.from(groups, ([key, groupDays]) => ({ key, label: auditMonthLabel(key), days: groupDays }));
}

const configSectionLabels: Record<AdminConfigSetting['section'], string> = {
  model: 'Model',
  rag: 'RAG',
  paths: 'Paths',
  submission: 'Submission',
  operations: 'Operations',
};

function groupedConfigSettings(settings: AdminConfigSetting[]) {
  return (Object.keys(configSectionLabels) as AdminConfigSetting['section'][]).map((section) => ({
    section,
    label: configSectionLabels[section],
    settings: settings.filter((setting) => setting.section === section),
  })).filter((group) => group.settings.length);
}

function activeMentionQuery(value: string): string | null {
  const match = /(^|\s)@([a-z0-9._-]*)$/i.exec(value);
  return match ? match[2].toLowerCase() : null;
}

function insertMention(value: string, username: string): string {
  return value.replace(/(^|\s)@[a-z0-9._-]*$/i, (match, prefix: string) => `${prefix}@${username} `);
}

function renderPlainInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(`([^`]+)`|\*\*([^*]+)\*\*)/g;
  let lastIndex = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(tokenPattern)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      nodes.push(<code key={`${keyPrefix}-code-${tokenIndex}`}>{match[2]}</code>);
    } else {
      nodes.push(<strong key={`${keyPrefix}-strong-${tokenIndex}`}>{match[3]}</strong>);
    }

    lastIndex = match.index + match[0].length;
    tokenIndex += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function safeMarkdownHref(value: string): string | null {
  const href = value.trim().replace(/[.,;:!?]+$/, '');
  return /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:/i.test(href) && !/^mailto:/i.test(href) ? null : href;
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const linkPattern = /\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<)]+)/g;
  let lastIndex = 0;
  let linkIndex = 0;

  for (const match of text.matchAll(linkPattern)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      nodes.push(...renderPlainInline(text.slice(lastIndex, match.index), `${keyPrefix}-text-${linkIndex}`));
    }

    const rawHref = match[2] || match[3] || '';
    const href = safeMarkdownHref(rawHref);
    const trailing = href ? rawHref.slice(href.length) : '';
    nodes.push(href ? (
      <a key={`${keyPrefix}-link-${linkIndex}`} href={href} target="_blank" rel="noreferrer">
        {match[1] || href}
      </a>
    ) : (
      match[1] || rawHref
    ));
    if (trailing) {
      nodes.push(trailing);
    }

    lastIndex = match.index + match[0].length;
    linkIndex += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(...renderPlainInline(text.slice(lastIndex), `${keyPrefix}-text-end`));
  }

  return nodes;
}

function renderInlineLines(text: string, keyPrefix: string): ReactNode[] {
  return text.split('\n').flatMap((line, index) => [
    ...(index ? [<br key={`${keyPrefix}-br-${index}`} />] : []),
    ...renderInlineMarkdown(line, `${keyPrefix}-line-${index}`),
  ]);
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const nodes: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      nodes.push(
        <pre key={`code-${index}`}>
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const headingContent = renderInlineMarkdown(heading[2], `heading-${index}`);
      if (level === 1) {
        nodes.push(<h3 key={`heading-${index}`}>{headingContent}</h3>);
      } else if (level === 2) {
        nodes.push(<h4 key={`heading-${index}`}>{headingContent}</h4>);
      } else {
        nodes.push(<h5 key={`heading-${index}`}>{headingContent}</h5>);
      }
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(<li key={`li-${index}`}>{renderInlineMarkdown(lines[index].replace(/^\s*[-*]\s+/, ''), `li-${index}`)}</li>);
        index += 1;
      }
      nodes.push(<ul key={`ul-${index}`}>{items}</ul>);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(<li key={`oli-${index}`}>{renderInlineMarkdown(lines[index].replace(/^\s*\d+\.\s+/, ''), `oli-${index}`)}</li>);
        index += 1;
      }
      nodes.push(<ol key={`ol-${index}`}>{items}</ol>);
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,3})\s+/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index]) &&
      !lines[index].trim().startsWith('```')
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    nodes.push(<p key={`p-${index}`}>{renderInlineLines(paragraph.join('\n'), `p-${index}`)}</p>);
  }

  return <>{nodes}</>;
}

function viewerAliases(viewer: CurrentUser) {
  const displayName = normalizedName(viewer.displayName);
  return [normalizedName(viewer.username), displayName, displayName.split(' ')[0], ...viewer.aliases.map(normalizedName)].filter(Boolean);
}

function isViewerName(value: string, viewer: CurrentUser) {
  return viewerAliases(viewer).includes(normalizedName(value));
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2)).toUpperCase();
}

function profileAvatarUrl(user: CurrentUser): string {
  return user.profile?.avatarUrl || '';
}

function passwordStrength(password: string): PasswordStrength {
  const hasLetter = /[A-Za-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  if (password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password) && hasDigit && hasSpecial) {
    return 'strong';
  }
  if (password.length >= 8 && hasLetter && hasDigit && hasSpecial) return 'medium';
  return 'weak';
}

function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const strength = passwordStrength(password);
  return (
    <div className={`password-strength password-strength-${strength}`} aria-live="polite">
      <span />
      <strong>{titleCase(strength)}</strong>
    </div>
  );
}

function AvatarCircle({ user, className = '' }: { user: CurrentUser; className?: string }) {
  const avatarUrl = profileAvatarUrl(user);
  return (
    <span className={`user-avatar ${className}`}>
      {avatarUrl ? <img src={avatarUrl} alt="" /> : initials(user.displayName || user.username)}
    </span>
  );
}

function evidence(project: DerivedLabStateProject) {
  return project.derived.signals.map((signal) => signalLabels[signal] || signal).join(', ') || 'no risk signals';
}

function StageBar({ stage }: { stage: number }) {
  return (
    <div className="stage-bar" aria-label={`Stage ${stage} of 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} className={index < stage ? 'stage-filled' : ''} />
      ))}
    </div>
  );
}

function StatusChip({ status }: { status: ProjectStatus }) {
  return <span className={`ops-chip status-${status}`}>{statusLabels[status]}</span>;
}

function RecommendationChip({ recommendation }: { recommendation: ProjectRecommendation }) {
  return <span className={`ops-chip rec-${recommendation}`}>{recommendationLabels[recommendation]}</span>;
}

function ChecklistTagPill({ tag }: { tag: ChecklistTag }) {
  return <span className={`checklist-tag tag-${tag.toLowerCase()}`}>{tag}</span>;
}

function ConsolePageFrame({
  title,
  subtitle,
  badge,
  actions,
  tabs,
  children,
  className = '',
  wide = false,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <section className={`console-page ${className}`}>
      <header className="console-subheader">
        <div className="console-subtitle-row">
          <span className="console-page-title">{title}</span>
          {subtitle && <span className="console-page-subtitle">{subtitle}</span>}
          {badge}
        </div>
        {actions && <div className="console-subheader-actions">{actions}</div>}
      </header>
      {tabs}
      <div className="console-page-scroll">
        <div className={`console-page-inner ${wide ? 'wide' : ''}`}>{children}</div>
      </div>
    </section>
  );
}

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="console-app auth-shell">
      <div className="auth-wrap">
        <div className="auth-brand">
          <span className="brand-mark auth-mark" aria-hidden="true">
            <span />
          </span>
          <div>
            <strong>VioScope</strong>
            <small>The VIOS lab assistant</small>
          </div>
        </div>
        <section className="auth-card">{children}</section>
        <footer className="auth-footer">
          <span>VIOS Lab</span>
          <small>Internal tool. Access restricted to lab members.</small>
        </footer>
      </div>
    </main>
  );
}

function resolveConsoleTheme(theme: ConsoleTheme): 'light' | 'dark' {
  if (theme === 'system') {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

function applyConsoleTheme(theme: ConsoleTheme) {
  if (typeof document === 'undefined') return;
  if (resolveConsoleTheme(theme) === 'dark') {
    document.documentElement.dataset.theme = 'dark';
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function readStoredTheme(): ConsoleTheme {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem('vios-theme');
  if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  return 'system';
}

function AuthLoading() {
  return (
    <AuthFrame>
      <div className="auth-loading">
        <DotMatrixIcon variant="loading" size={24} />
        <span>Checking session</span>
      </div>
    </AuthFrame>
  );
}

function LoginView({ onLogin, initialError }: { onLogin: (user: CurrentUser) => void; initialError?: string | null }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(initialError || null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = (await response.json()) as AuthPayload;
      if (!response.ok || !body.user) {
        throw new Error(body.error || 'Login failed.');
      }
      onLogin(body.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <form className="auth-form" onSubmit={submit}>
        <div>
          <h1>Sign in</h1>
          <p>Use your VioScope account.</p>
        </div>
        <label>
          <span>Username</span>
          <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          <span>Password</span>
          <input
            autoComplete="current-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <div className="form-message error">{error}</div>}
        <button className="ops-primary" type="submit" disabled={busy}>
          <LogIn aria-hidden="true" />
          {busy ? 'Signing in' : 'Sign in'}
        </button>
      </form>
    </AuthFrame>
  );
}

function ChangePasswordView({
  user,
  onChanged,
  onLogout,
}: {
  user: CurrentUser;
  onChanged: (user: CurrentUser) => void;
  onLogout: () => Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [email, setEmail] = useState(user.email || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    if (passwordStrength(newPassword) === 'weak') {
      setError('Password must be 8+ characters with a letter, number, and special character.');
      return;
    }
    if (!user.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, email }),
      });
      const body = (await response.json()) as AuthPayload;
      if (!response.ok || !body.user) {
        throw new Error(body.error || 'Could not change password.');
      }
      onChanged(body.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <form className="auth-form" onSubmit={submit}>
        <div>
          <h1>Complete account setup</h1>
          <p>
            {user.email
              ? `${user.displayName} needs a medium or stronger password before continuing.`
              : `${user.displayName} needs an email and a medium or stronger password before continuing.`}
          </p>
        </div>
        <label>
          <span>Current password</span>
          <input
            autoComplete="current-password"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </label>
        {!user.email && (
          <label>
            <span>Email</span>
            <input
              autoComplete="email"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@university.ac.uk"
            />
          </label>
        )}
        <label>
          <span>New password</span>
          <input
            autoComplete="new-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <PasswordStrengthMeter password={newPassword} />
        </label>
        <label>
          <span>Confirm password</span>
          <input
            autoComplete="new-password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </label>
        {error && <div className="form-message error">{error}</div>}
        <div className="button-row">
          <button className="ops-primary" type="submit" disabled={busy}>
            <KeyRound aria-hidden="true" />
            {busy ? 'Saving' : 'Save password'}
          </button>
          <button className="ops-secondary" type="button" onClick={onLogout}>
            <LogOut aria-hidden="true" />
            Log out
          </button>
        </div>
      </form>
    </AuthFrame>
  );
}

function AccountDetailsPanel({
  user,
  onUserChanged,
}: {
  user: CurrentUser;
  onUserChanged: (user: CurrentUser) => void;
}) {
  const email = profileEmail(user);
  const [profileDraft, setProfileDraft] = useState({
    displayName: user.displayName,
    email: email === '-' ? '' : email,
    aliasesText: user.aliases.filter((alias) => alias !== email).join(', '),
    avatarUrl: profileAvatarUrl(user),
  });
  const [passwordDraft, setPasswordDraft] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [busyProfile, setBusyProfile] = useState(false);
  const [busyPassword, setBusyPassword] = useState(false);

  function chooseAvatar(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setProfileError(null);
    if (!file.type.startsWith('image/')) {
      setProfileError('Choose an image file.');
      return;
    }
    if (file.size > 500_000) {
      setProfileError('Choose an avatar under 500 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setProfileDraft((current) => ({ ...current, avatarUrl: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyProfile(true);
    setProfileError(null);
    setProfileMessage(null);

    try {
      const response = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: profileDraft.displayName,
          email: profileDraft.email,
          aliases: aliasesFromText(profileDraft.aliasesText),
          avatarUrl: profileDraft.avatarUrl,
        }),
      });
      const body = (await response.json()) as AuthPayload;
      if (!response.ok || !body.user) {
        throw new Error(body.error || 'Could not update account.');
      }
      onUserChanged(body.user);
      setProfileMessage('Account details saved.');
    } catch (caught) {
      setProfileError(caught instanceof Error ? caught.message : 'Could not update account.');
    } finally {
      setBusyProfile(false);
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordMessage(null);
    if (passwordDraft.newPassword !== passwordDraft.confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    if (passwordStrength(passwordDraft.newPassword) === 'weak') {
      setPasswordError('Password must be 8+ characters with a letter, number, and special character.');
      return;
    }

    setBusyPassword(true);
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwordDraft.currentPassword,
          newPassword: passwordDraft.newPassword,
        }),
      });
      const body = (await response.json()) as AuthPayload;
      if (!response.ok || !body.user) {
        throw new Error(body.error || 'Could not change password.');
      }
      onUserChanged(body.user);
      setPasswordDraft({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPasswordMessage('Password changed.');
    } catch (caught) {
      setPasswordError(caught instanceof Error ? caught.message : 'Could not change password.');
    } finally {
      setBusyPassword(false);
    }
  }

  return (
    <section className="ops-panel account-details-panel">
      <div className="ops-panel-head">
        <div>
          <h2>Personal details</h2>
          <p>{user.username} / {roleLabel(user.role)}</p>
        </div>
      </div>
        <div className="account-settings-grid">
          <form className="account-settings-card" onSubmit={saveProfile}>
            <div className="account-avatar-row">
              <span className="user-avatar large">
                {profileDraft.avatarUrl ? <img src={profileDraft.avatarUrl} alt="" /> : initials(profileDraft.displayName || user.username)}
              </span>
              <label className="avatar-upload avatar-upload-icon" aria-label="Upload avatar" title="Upload avatar">
                <Upload aria-hidden="true" />
                <input accept="image/*" type="file" onChange={chooseAvatar} />
              </label>
            </div>
            <label>
              <span>Display name</span>
              <input
                value={profileDraft.displayName}
                onChange={(event) => setProfileDraft((current) => ({ ...current, displayName: event.target.value }))}
              />
            </label>
            <label>
              <span>Email</span>
              <input
                autoComplete="email"
                required
                type="email"
                value={profileDraft.email}
                onChange={(event) => setProfileDraft((current) => ({ ...current, email: event.target.value }))}
                placeholder="name@university.ac.uk"
              />
            </label>
            <label>
              <span>Aliases</span>
              <input
                value={profileDraft.aliasesText}
                onChange={(event) => setProfileDraft((current) => ({ ...current, aliasesText: event.target.value }))}
                placeholder="names or handles, comma-separated"
              />
            </label>
            {profileError && <div className="form-message error">{profileError}</div>}
            {profileMessage && <div className="form-message">{profileMessage}</div>}
            <button className="ops-primary" type="submit" disabled={busyProfile}>
              <Save aria-hidden="true" />
              {busyProfile ? 'Saving' : 'Save account'}
            </button>
          </form>

          <form className="account-settings-card" onSubmit={savePassword}>
            <h3>Change password</h3>
            <label>
              <span>Current password</span>
              <input
                autoComplete="current-password"
                type="password"
                value={passwordDraft.currentPassword}
                onChange={(event) => setPasswordDraft((current) => ({ ...current, currentPassword: event.target.value }))}
              />
            </label>
            <label>
              <span>New password</span>
              <input
                autoComplete="new-password"
                type="password"
                value={passwordDraft.newPassword}
                onChange={(event) => setPasswordDraft((current) => ({ ...current, newPassword: event.target.value }))}
              />
              <PasswordStrengthMeter password={passwordDraft.newPassword} />
            </label>
            <label>
              <span>Confirm password</span>
              <input
                autoComplete="new-password"
                type="password"
                value={passwordDraft.confirmPassword}
                onChange={(event) => setPasswordDraft((current) => ({ ...current, confirmPassword: event.target.value }))}
              />
            </label>
            {passwordError && <div className="form-message error">{passwordError}</div>}
            {passwordMessage && <div className="form-message">{passwordMessage}</div>}
            <button className="ops-primary" type="submit" disabled={busyPassword}>
              <KeyRound aria-hidden="true" />
              {busyPassword ? 'Saving' : 'Save password'}
            </button>
          </form>
        </div>
    </section>
  );
}

function ProjectCard({ project }: { project: DerivedLabStateProject }) {
  return (
    <article className="project-card">
      <div className="project-card-head">
        <div>
          <span className="track-chip">Track {project.track}</span>
          <h3>{titleCase(project.project)}</h3>
        </div>
        <StatusChip status={project.status} />
      </div>
      <div className="stage-row">
        <span>
          Stage {project.stage} / 5 - {project.derived.weeks_in_stage ?? 'unknown'} weeks
        </span>
        <StageBar stage={project.stage} />
      </div>
      <div className="project-meta-row">
        <span>Target</span>
        <strong>{project.target || 'Not set'}</strong>
      </div>
      <div className="project-meta-row">
        <span>Last update</span>
        <strong>{formatAge(project.derived.days_since_update)} ago</strong>
      </div>
      {project.blocker && <p className="project-blocker">{project.blocker}</p>}
    </article>
  );
}

function ThemeMeetingPanel({
  payload,
  loading,
  onChanged,
  viewer,
}: {
  payload: ThemeMeetingPayload | null;
  loading: boolean;
  onChanged: () => Promise<void>;
  viewer: CurrentUser;
}) {
  const [themeId, setThemeId] = useState('');
  const [member, setMember] = useState('');
  const [updateType, setUpdateType] = useState<ThemeUpdateType>('short_update');
  const [progressText, setProgressText] = useState('');
  const [questions, setQuestions] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [memberCandidateByTheme, setMemberCandidateByTheme] = useState<Record<string, string>>({});

  const plan = payload?.plan;
  const userDirectory = payload?.users || [];
  const managedThemeIds = useMemo(() => new Set(payload?.access?.canManageThemeIds || []), [payload?.access?.canManageThemeIds]);
  const selectedMeeting = plan?.meetings.find((meeting) => meeting.theme_id === themeId) || plan?.meetings[0];
  const selectedThemeId = selectedMeeting?.theme_id || '';
  const submitMembers = useMemo(() => {
    if (!selectedMeeting) {
      return [];
    }

    if (canSeeAllRole(viewer.role)) {
      return selectedMeeting.members.map((displayName, index) => ({
        displayName,
        username: selectedMeeting.member_usernames[index] || displayName,
      }));
    }

    const ownMembers = selectedMeeting.members
      .map((displayName, index) => ({
        displayName,
        username: selectedMeeting.member_usernames[index] || displayName,
      }))
      .filter((nextMember) => nextMember.username === viewer.username || isViewerName(nextMember.displayName, viewer));
    return ownMembers.length ? ownMembers : [{ displayName: viewer.displayName || viewer.username, username: viewer.username }];
  }, [selectedMeeting, viewer]);

  useEffect(() => {
    if (selectedThemeId && themeId !== selectedThemeId) {
      setThemeId(selectedThemeId);
    }
  }, [selectedThemeId, themeId]);

  useEffect(() => {
    if (submitMembers.length && !submitMembers.some((nextMember) => nextMember.username === member)) {
      setMember(submitMembers[0].username);
    }
  }, [member, submitMembers]);

  async function enableBrowserNotifications() {
    if (!('Notification' in window)) {
      setFormError('This browser does not support notifications.');
      return;
    }

    const permission = await Notification.requestPermission();
    setStatus(permission === 'granted' ? 'Browser notifications enabled.' : 'Browser notifications not enabled.');
  }

  async function submitUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setStatus(null);

    if (!selectedMeeting) {
      setFormError('No active theme meeting is available.');
      return;
    }

    const response = await fetch('/api/theme-meetings/updates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetingDate: plan?.meeting_date,
        themeId,
        member,
        updateType,
        progressText,
        questions,
      }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setFormError(body.error || 'Could not save update.');
      return;
    }

    setStatus('Update saved.');
    setProgressText('');
    setQuestions('');
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Theme update saved', { body: `${member} / Theme ${themeId}` });
    }
    await onChanged();
  }

  async function sendMissingReminders(nextThemeId: string) {
    setFormError(null);
    setStatus(null);
    const response = await fetch('/api/theme-meetings/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'manual_missing_update_reminder',
        meetingDate: plan?.meeting_date,
        themeId: nextThemeId,
      }),
    });
    const body = (await response.json()) as { notifications?: unknown[]; error?: string };
    if (!response.ok) {
      setFormError(body.error || 'Could not send reminders.');
      return;
    }

    setStatus(`Sent ${body.notifications?.length || 0} missing-update reminders.`);
    await onChanged();
  }

  async function changeThemeMember(nextThemeId: string, action: 'add' | 'remove', username: string) {
    setFormError(null);
    setStatus(null);
    const response = await fetch('/api/theme-meetings/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetingDate: plan?.meeting_date,
        themeId: nextThemeId,
        action,
        username,
      }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setFormError(body.error || 'Could not update theme members.');
      return;
    }

    setStatus(action === 'add' ? 'Member added.' : 'Member removed.');
    await onChanged();
  }

  return (
    <section className="ops-panel theme-meeting-panel">
      <div className="ops-panel-head">
        <div>
          <h2>Theme meeting planner</h2>
          <p>
            {plan
              ? `${plan.meeting_date} / ${plan.cycle_group} / ${plan.timezone}`
              : loading
                ? 'Loading current theme meeting cycle.'
                : 'Theme meeting data is unavailable.'}
          </p>
        </div>
        <button className="ops-secondary" type="button" onClick={enableBrowserNotifications}>
          <Bell aria-hidden="true" />
          Notify
        </button>
      </div>

      {!plan ? (
        <div className="ops-empty">
          {loading ? (
            <>
              <DotMatrixIcon variant="loading" size={24} />
              Loading theme meetings
            </>
          ) : (
            'Could not load theme meetings. Check the error above, then refresh.'
          )}
        </div>
      ) : !plan.meetings.length ? (
        <div className="ops-empty">No active theme meeting for this account</div>
      ) : (
        <div className="theme-meeting-grid">
          <div className="theme-meeting-list">
            {plan.meetings.map((meeting) => (
              <article className="theme-meeting-card" key={meeting.theme_id}>
                <div className="theme-meeting-card-head">
                  <div>
                    <span className="track-chip">Theme {meeting.theme_id}</span>
                    <h3>{meeting.title}</h3>
                  </div>
                  <strong>{meeting.time}</strong>
                </div>
                <div className="theme-stats">
                  <span>{meeting.duration_minutes} min</span>
                  <span>{meeting.submitted_members.length}/{meeting.members.length} submitted</span>
                  <span>{meeting.planned_minutes}/{meeting.duration_minutes} planned</span>
                </div>
                <p className="theme-coordinator">Coordinator: {meeting.coordinator}</p>
                <div className="agenda-mini">
                  {meeting.agenda_items.length ? (
                    meeting.agenda_items.map((item) => (
                      <div key={`${item.member}-${item.submitted_at}`}>
                        <strong>{item.member}</strong>
                        <span>
                          {updateTypeLabels[item.update_type]} / {item.duration_minutes} min
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="ops-muted-line">No planned updates yet</div>
                  )}
                </div>
                <p className="theme-missing">Missing: {meeting.missing_members.join(', ') || 'none'}</p>
                {managedThemeIds.has(meeting.theme_id) && (
                  <div className="theme-member-manager">
                    <button
                      className="ops-secondary"
                      type="button"
                      disabled={!meeting.missing_members.length}
                      onClick={() => sendMissingReminders(meeting.theme_id)}
                    >
                      <Bell aria-hidden="true" />
                      Remind missing
                    </button>
                    <div className="theme-member-list">
                      {meeting.members.map((nextMember, index) => {
                        const username = meeting.member_usernames[index] || nextMember;
                        return (
                          <span key={`${meeting.theme_id}-${username}`}>
                            {nextMember}
                            <button
                              aria-label={`Remove ${nextMember}`}
                              type="button"
                              onClick={() => changeThemeMember(meeting.theme_id, 'remove', username)}
                            >
                              <X aria-hidden="true" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                    <div className="theme-member-add">
                      <select
                        value={memberCandidateByTheme[meeting.theme_id] || ''}
                        onChange={(event) =>
                          setMemberCandidateByTheme((current) => ({ ...current, [meeting.theme_id]: event.target.value }))
                        }
                      >
                        <option value="">Add user</option>
                        {userDirectory
                          .filter((userOption) => !meeting.member_usernames.includes(userOption.username))
                          .map((userOption) => (
                            <option key={userOption.id} value={userOption.username}>
                              {userOption.displayName}
                            </option>
                          ))}
                      </select>
                      <button
                        className="ops-secondary"
                        type="button"
                        disabled={!memberCandidateByTheme[meeting.theme_id]}
                        onClick={() => changeThemeMember(meeting.theme_id, 'add', memberCandidateByTheme[meeting.theme_id])}
                      >
                        <Plus aria-hidden="true" />
                        Add
                      </button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>

          <form className="theme-update-form" onSubmit={submitUpdate}>
            <h3>Submit personal update</h3>
            <label>
              <span>Theme</span>
              <select value={themeId} onChange={(event) => setThemeId(event.target.value)}>
                {plan.meetings.map((meeting) => (
                  <option key={meeting.theme_id} value={meeting.theme_id}>
                    Theme {meeting.theme_id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Member</span>
              <select value={member} onChange={(event) => setMember(event.target.value)}>
                {submitMembers.map((nextMember) => (
                  <option key={nextMember.username} value={nextMember.username}>
                    {nextMember.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Update type</span>
              <select value={updateType} onChange={(event) => setUpdateType(event.target.value as ThemeUpdateType)}>
                {(Object.keys(updateTypeLabels) as ThemeUpdateType[]).map((nextType) => (
                  <option key={nextType} value={nextType}>
                    {updateTypeLabels[nextType]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Progress</span>
              <textarea
                value={progressText}
                onChange={(event) => setProgressText(event.target.value)}
                placeholder="About 30 words"
                rows={4}
              />
            </label>
            <label>
              <span>Questions</span>
              <textarea
                value={questions}
                onChange={(event) => setQuestions(event.target.value)}
                placeholder={updateType === 'nothing_to_report' ? 'Optional' : 'Required for help from the group'}
                rows={3}
              />
            </label>
            {formError && <div className="form-message error">{formError}</div>}
            {status && <div className="form-message">{status}</div>}
            <button className="ops-primary" type="submit">
              <Check aria-hidden="true" />
              Save update
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

function DashboardView({
  payload,
  loading,
  viewer,
}: {
  payload: LabStatePayload | null;
  loading: boolean;
  viewer: CurrentUser;
}) {
  const canSeeAll = canSeeAllRole(viewer.role);
  const mode: DashboardMode = canSeeAll ? 'pi' : 'member';
  const [confirmed, setConfirmed] = useState(false);
  const [agendaState, setAgendaState] = useState<Record<string, 'added' | 'dismissed'>>({});

  const projects = payload?.state.projects || [];
  const summary = payload?.summary;
  const memberOwner = projects.find((project) => isViewerName(project.owner, viewer))?.owner || viewer.displayName || viewer.username;
  const memberProjects = projects.filter((project) => isViewerName(project.owner, viewer));
  const attentionProjects = summary?.projectsNeedingAttention || [];
  const agendaCandidates = attentionProjects.filter((project) => agendaState[project.project] !== 'dismissed');
  const deepDiveProjects = agendaCandidates.filter((project) => project.derived.recommendation === 'deep_dive');
  const memberArtifacts = memberProjects.flatMap((project) =>
    project.artifacts.map((artifact) => ({ project: project.project, artifact })),
  );

  return (
    <ConsolePageFrame
      title="Dashboard"
      badge={
        canSeeAll && mode === 'pi' ? (
          <span className="prototype-pill admin-access">
            <ShieldCheck aria-hidden="true" />
            Lab-wide view
          </span>
        ) : (
          <span className="prototype-pill">
            <ShieldCheck aria-hidden="true" />
            My projects
          </span>
        )
      }
    >
      <div className="dashboard-content">
      {payload?.source === 'fixture' && (
        <div className="ops-notice">
          <AlertCircle aria-hidden="true" />
          <span>Showing fixture lab state until LAB_STATE_PATH or DATASTORE_DIR is configured.</span>
        </div>
      )}

      {!payload ? (
        <div className="ops-empty">
          {loading ? (
            <>
              <DotMatrixIcon variant="loading" size={24} />
              Loading lab state
            </>
          ) : (
            'Could not load lab state. Check the error above, then refresh.'
          )}
        </div>
      ) : mode === 'member' ? (
        <div className="dashboard-stack">
          <div className="summary-strip">
            <span>{memberOwner}</span>
            <strong>{memberProjects.length} projects</strong>
            <strong>{memberProjects.filter((project) => project.derived.recommendation !== 'none').length} need attention</strong>
          </div>

          <div className="project-grid">
            {memberProjects.map((project) => (
              <ProjectCard key={project.project} project={project} />
            ))}
          </div>

          <div className="dashboard-split">
            <section className="ops-panel">
              <div className="ops-panel-head">
                <div>
                  <h2>This week's theme meeting</h2>
                  <p>Agenda assembled from current project state.</p>
                </div>
                <RecommendationChip recommendation={attentionProjects[0]?.derived.recommendation || 'none'} />
              </div>
              <ol className="agenda-list">
                <li>Round-table status check</li>
                {(deepDiveProjects.length ? deepDiveProjects : attentionProjects).slice(0, 2).map((project) => (
                  <li key={project.project}>Deep dive: {titleCase(project.project)}</li>
                ))}
                <li>Submission and materials follow-ups</li>
              </ol>
              <div className="confirm-box">
                <strong>Confirm your status for the round-table</strong>
                <p>
                  {memberProjects[0]
                    ? `${titleCase(memberProjects[0].project)} is ${statusLabels[memberProjects[0].status].toLowerCase()}; last update was ${formatAge(
                        memberProjects[0].derived.days_since_update,
                      )} ago.`
                    : 'No member project is available.'}
                </p>
                <div className="button-row">
                  <button className="ops-primary" type="button" onClick={() => setConfirmed(true)}>
                    <Check aria-hidden="true" />
                    {confirmed ? 'Confirmed' : 'Confirm'}
                  </button>
                  <button className="ops-secondary" type="button">
                    Tweak
                  </button>
                </div>
              </div>
            </section>

            <section className="ops-panel">
              <div className="ops-panel-head">
                <div>
                  <h2>My library</h2>
                  <p>{memberArtifacts.length} linked materials</p>
                </div>
                <FileText aria-hidden="true" />
              </div>
              <div className="library-list">
                {memberArtifacts.length ? (
                  memberArtifacts.map((item) => (
                    <a href={item.artifact} key={item.artifact}>
                      <span>{item.artifact.split('/').pop()}</span>
                      <small>{titleCase(item.project)}</small>
                    </a>
                  ))
                ) : (
                  <div className="ops-muted-line">No artifacts linked yet</div>
                )}
              </div>
            </section>
          </div>
        </div>
      ) : (
        <div className="dashboard-stack">
          <div className="summary-strip">
            <span>Lab-wide view</span>
            <strong>{summary?.totalProjects || 0} projects</strong>
            <strong>{summary?.byRecommendation.deep_dive || 0} deep dives</strong>
            <strong>{summary?.byRecommendation.nudge || 0} nudges</strong>
          </div>

          <section className="ops-panel">
            <div className="ops-panel-head">
              <div>
                <h2>Suggested deep dives this week</h2>
                <p>Advisory suggestions. The organizer decides what goes on the agenda.</p>
              </div>
              <ShieldCheck aria-hidden="true" />
            </div>
            <div className="attention-grid">
              {agendaCandidates.length ? (
                agendaCandidates.map((project) => (
                  <article className="attention-card" key={project.project}>
                    <div>
                      <h3>{titleCase(project.project)}</h3>
                      <p>
                        {project.owner} / stage {project.stage} / last update {formatAge(project.derived.days_since_update)} ago
                      </p>
                    </div>
                    <RecommendationChip recommendation={project.derived.recommendation} />
                    <p>
                      <strong>Evidence:</strong> {evidence(project)}
                    </p>
                    <div className="button-row">
                      <button
                        className="ops-primary"
                        type="button"
                        onClick={() => setAgendaState((current) => ({ ...current, [project.project]: 'added' }))}
                      >
                        {agendaState[project.project] === 'added' ? 'Added' : 'Add to agenda'}
                      </button>
                      <button
                        className="ops-secondary"
                        type="button"
                        onClick={() => setAgendaState((current) => ({ ...current, [project.project]: 'dismissed' }))}
                      >
                        Dismiss
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="ops-muted-line">No projects currently need attention</div>
              )}
            </div>
          </section>

          <section className="ops-panel">
            <div className="ops-panel-head">
              <div>
                <h2>All projects</h2>
                <p>Status, stage, deadlines, and linked materials.</p>
              </div>
              <Search aria-hidden="true" />
            </div>
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Owner</th>
                    <th>Project</th>
                    <th>Track</th>
                    <th>Stage</th>
                    <th>Status</th>
                    <th>Target</th>
                    <th>Materials</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.project}>
                      <td>{project.owner}</td>
                      <td>{titleCase(project.project)}</td>
                      <td>{project.track}</td>
                      <td>
                        <div className="table-stage">
                          <StageBar stage={project.stage} />
                          <span>{project.stage}/5</span>
                        </div>
                      </td>
                      <td>
                        <StatusChip status={project.status} />
                      </td>
                      <td>{project.target || 'Not set'}</td>
                      <td>{project.artifacts.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
      </div>
    </ConsolePageFrame>
  );
}

function MeetingView({
  payload,
  loading,
  onThemeMeetingChanged,
  viewer,
}: {
  payload: ThemeMeetingPayload | null;
  loading: boolean;
  onThemeMeetingChanged: () => Promise<void>;
  viewer: CurrentUser;
}) {
  return (
    <ConsolePageFrame
      title="Theme meeting"
      subtitle="Dashboard / Theme meeting"
      className="meeting-page"
      wide
      badge={
        <span className="prototype-pill">
          <CalendarDays aria-hidden="true" />
          {canSeeAllRole(viewer.role) ? 'Organizer view' : 'Member view'}
        </span>
      }
    >
      <ThemeMeetingPanel payload={payload} loading={loading} onChanged={onThemeMeetingChanged} viewer={viewer} />
    </ConsolePageFrame>
  );
}

function ChatView({
  viewer,
  openThreadId,
  onOpenThreadHandled,
}: {
  viewer: CurrentUser;
  openThreadId: string | null;
  onOpenThreadHandled: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState(() => `web-${Date.now()}`);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMode, setHistoryMode] = useState<ChatHistoryMode>('owned');
  const [mentionUsers, setMentionUsers] = useState<MentionableUser[]>([]);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const loadServerSessions = useCallback(async () => {
    const response = await fetch('/api/chat/sessions');
    const body = (await response.json()) as ChatSessionsPayload;
    if (!response.ok) {
      throw new Error(body.error || 'Could not load chat sessions.');
    }
    setSessions(body.sessions || []);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function syncSessions() {
      const imported = await importLocalChatSessionsOnce(viewer.id);
      if (!cancelled) {
        await loadServerSessions();
        if (imported) {
          setSendStatus(`Imported ${imported} local chat session${imported === 1 ? '' : 's'}.`);
        }
      }
    }

    void syncSessions().catch((caught) => {
      if (!cancelled) {
        setSendStatus(caught instanceof Error ? caught.message : 'Could not load chat sessions.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadServerSessions, viewer.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadMentionUsers() {
      const response = await fetch('/api/chat/users');
      const body = (await response.json()) as MentionUsersPayload;
      if (!response.ok) {
        throw new Error(body.error || 'Could not load users.');
      }
      if (!cancelled) {
        setMentionUsers((body.users || []).filter((user) => user.id !== viewer.id));
      }
    }

    void loadMentionUsers().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [viewer.id]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll) {
      scroll.scrollTop = scroll.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!openThreadId) return;
    const session = sessions.find((candidate) => candidate.threadId === openThreadId);
    if (!session) return;
    restoreChat(session);
    setHistoryMode(session.membershipKind === 'shared' ? 'shared' : 'owned');
    onOpenThreadHandled();
  }, [openThreadId, onOpenThreadHandled, sessions]);

  const mentionQuery = activeMentionQuery(draft);
  const mentionOptions = useMemo(() => {
    if (mentionQuery === null) return [];
    return mentionUsers
      .filter((user) => {
        const haystack = `${user.username} ${user.displayName}`.toLowerCase();
        return haystack.includes(mentionQuery);
      })
      .slice(0, 6);
  }, [mentionQuery, mentionUsers]);

  const ownedSessions = sessions.filter((session) => session.membershipKind !== 'shared');
  const sharedSessions = sessions.filter((session) => session.membershipKind === 'shared');
  const visibleSessions = historyMode === 'owned' ? ownedSessions : sharedSessions;

  function newChat() {
    setThreadId(`web-${Date.now()}`);
    setMessages([]);
    setDraft('');
    setSendStatus(null);
    setHistoryOpen(false);
  }

  function restoreChat(session: ChatSession) {
    setThreadId(session.threadId);
    setMessages(session.messages);
    setSendStatus(null);
    setHistoryOpen(false);
  }

  function chooseMention(username: string) {
    setDraft((current) => insertMention(current, username));
  }

  async function send(nextQuestion = draft) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || isSending) return;
    const assistantId = chatMessageId('assistant');
    setDraft('');
    setSendStatus(null);
    setIsSending(true);
    setMessages((current) => [
      ...current,
      { id: chatMessageId('user'), role: 'user', text: trimmed },
      { id: assistantId, role: 'assistant', text: 'Searching the wiki', status: 'thinking' },
    ]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, threadId }),
      });
      const body = (await response.json()) as {
        text?: string;
        threadId?: string;
        sources?: ChatSource[];
        mentions?: ChatMentionResult;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error || 'Could not reach VioScope.');
      }
      if (body.threadId) {
        setThreadId(body.threadId);
      }
      const answer = body.text || '';
      const sources = body.sources || [];
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, text: answer, sources, status: refusalPattern.test(answer) ? 'refusal' : 'answer' }
            : message,
        ),
      );
      const sharedNames = body.mentions?.shared.map((user) => `@${user.username}`) || [];
      const unknownNames = body.mentions?.unknown.map((username) => `@${username}`) || [];
      if (sharedNames.length || unknownNames.length) {
        setSendStatus(
          [
            sharedNames.length ? `Shared with ${sharedNames.join(', ')}` : '',
            unknownNames.length ? `No active account for ${unknownNames.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('. '),
        );
      }
      void loadServerSessions().catch(() => undefined);
    } catch (caught) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                text: caught instanceof Error ? caught.message : 'Could not reach VioScope.',
                status: 'refusal',
              }
            : message,
        ),
      );
      setSendStatus(caught instanceof Error ? caught.message : 'Could not reach VioScope.');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <ConsolePageFrame
      title="Wiki assistant"
      className="chat-page"
      badge={
        <span className="prototype-pill">
          <span className="live-dot" aria-hidden="true" />
          Grounded in VIOS wiki
        </span>
      }
      actions={
        <div className="chat-actions">
          <button
            className="icon-button"
            type="button"
            onClick={() => setHistoryOpen((current) => !current)}
            aria-label="Chat history"
            title="Chat history"
          >
            <History aria-hidden="true" />
          </button>
          <button className="icon-button" type="button" onClick={newChat} aria-label="New chat" title="New chat">
            <Plus aria-hidden="true" />
          </button>
        </div>
      }
    >
      <section className="chat-view">

      <div className="chat-scroll" ref={scrollRef}>
        {historyOpen && (
          <section className="chat-history-panel">
            <div className="chat-history-head">
              <strong>{historyMode === 'owned' ? 'History' : 'Shared sessions'}</strong>
              <small>{visibleSessions.length} session{visibleSessions.length === 1 ? '' : 's'}</small>
            </div>
            <div className="chat-history-tabs" role="tablist" aria-label="Chat session lists">
              <button
                className={historyMode === 'owned' ? 'active' : ''}
                type="button"
                onClick={() => setHistoryMode('owned')}
              >
                History
              </button>
              <button
                className={historyMode === 'shared' ? 'active' : ''}
                type="button"
                onClick={() => setHistoryMode('shared')}
              >
                Shared
              </button>
            </div>
            {visibleSessions.length ? (
              <div className="chat-history-list">
                {visibleSessions.map((session) => (
                  <button
                    className={session.threadId === threadId ? 'active' : ''}
                    key={session.threadId}
                    type="button"
                    onClick={() => restoreChat(session)}
                  >
                    <span>{session.title}</span>
                    <small>
                      {historyMode === 'shared'
                        ? `Shared by ${session.sharedByDisplayName || session.ownerDisplayName || 'a teammate'} · `
                        : ''}
                      {chatSessionTime(session.updatedAt)}
                    </small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="chat-history-empty">
                {historyMode === 'shared' ? 'No shared chat sessions yet.' : 'No saved chat sessions yet.'}
              </p>
            )}
          </section>
        )}

        {messages.length === 0 && (
          <div className="chat-empty">
            <DotMatrixIcon iconIndex={0} size={48} />
            <h2>I answer questions from the VIOS lab wiki</h2>
            <div className="prompt-grid">
              {prompts.map((prompt) => (
                <button key={prompt} type="button" onClick={() => send(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.length > 0 && (
          <div className="conversation">
            {messages.map((message) =>
              message.role === 'user' ? (
                <div className="user-bubble" key={message.id}>{message.text}</div>
              ) : (
                <div className="assistant-turn" key={message.id}>
                  <div className="assistant-label">
                    <DotMatrixIcon iconIndex={message.status === 'thinking' ? 1 : 3} size={24} autoPlay={message.status === 'thinking'} />
                    VioScope
                  </div>
                  {message.status === 'refusal' ? (
                    <div className="refusal-box">
                      <AlertCircle aria-hidden="true" />
                      <div>
                        <strong>VioScope could not complete that request</strong>
                        <p>{message.text || 'Please try again with a little more detail.'}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="assistant-answer">
                      {message.status === 'thinking' ? (
                        <span>
                          Searching the wiki
                          <span className="typing-dots" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </span>
                        </span>
                      ) : (
                        <>
                          <MarkdownText text={message.text} />
                          {Boolean(message.sources?.length) && (
                            <div className="chat-sources">
                              <strong>Sources</strong>
                              {message.sources?.map((source) => (
                                <a href={source.url} key={source.url} target="_blank" rel="noreferrer">
                                  <span>{source.title}</span>
                                  {source.path && <small>{source.path}</small>}
                                </a>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <div className="chat-input-wrap">
        {mentionQuery !== null && mentionOptions.length > 0 && (
          <div className="mention-menu">
            {mentionOptions.map((user) => (
              <button key={user.id} type="button" onClick={() => chooseMention(user.username)}>
                <strong>@{user.username}</strong>
                <span>{user.displayName}</span>
              </button>
            ))}
          </div>
        )}
        <form
          className="chat-input"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <span>{viewer.displayName || 'VioScope'}</span>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask or @mention a teammate"
            disabled={isSending}
          />
          <button aria-label="Send" type="submit" disabled={isSending || !draft.trim()}>
            <Send aria-hidden="true" />
          </button>
        </form>
        {sendStatus && <small className="chat-send-status">{sendStatus}</small>}
      </div>
      </section>
    </ConsolePageFrame>
  );
}

function ChecklistsView({ canSignOff }: { canSignOff: boolean }) {
  const [activeChecklistId, setActiveChecklistId] = useState<ChecklistTemplateId>('idea');
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const activeChecklist = checklistTemplates.find((template) => template.id === activeChecklistId) || checklistTemplates[0];

  function openWorkbench() {
    workbenchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const checklistTabs = (
    <div className="console-page-tabs checklist-tabs" role="tablist" aria-label="Review checklist templates">
      {checklistTemplates.map((template) => (
        <button
          key={template.id}
          className={activeChecklist.id === template.id ? 'selected' : ''}
          type="button"
          role="tab"
          aria-selected={activeChecklist.id === template.id}
          onClick={() => setActiveChecklistId(template.id)}
        >
          {template.label}
        </button>
      ))}
    </div>
  );

  return (
    <ConsolePageFrame
      title="Review checklists"
      subtitle="Advisory pre-submission checks; the human always signs off"
      className="checklists-page"
      wide
      tabs={checklistTabs}
      badge={
        <span className="prototype-pill">
          <ShieldCheck aria-hidden="true" />
          Evidence required
        </span>
      }
    >

      <div className="checklist-layout">
        <section className="checklist-template-card" aria-label={`${activeChecklist.label} checklist`}>
          <header>
            <div>
              <h2>{activeChecklist.label}</h2>
              <p>{activeChecklist.description}</p>
            </div>
            <span>v{activeChecklist.version}</span>
          </header>
          <div className="checklist-items">
            {activeChecklist.items.map((item, index) => (
              <article key={`${activeChecklist.id}-${item.title}`} className="checklist-item">
                <span className="checklist-index">{index + 1}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
                <ChecklistTagPill tag={item.tag} />
              </article>
            ))}
          </div>
        </section>

        <div className="checklist-side">
          <section className="checklist-run-card">
            <div className="checklist-run-icon" aria-hidden="true">
              {activeChecklist.status === 'available' ? <Check /> : <FileText />}
            </div>
            <h2>{activeChecklist.status === 'available' ? 'Ready in the workbench' : 'Template preview'}</h2>
            <p>
              {activeChecklist.status === 'available'
                ? `Run ${activeChecklist.shortLabel} with the live B2 review workbench below. Results include verdicts, evidence, and optional sign-off.`
                : 'Idea Pitch is present in the latest prototype, but it is not wired to the B2 runner yet.'}
            </p>
            <div className="checklist-upload-note">
              <FileText aria-hidden="true" />
              <span>Live uploads support .md, .txt, .tex, .rst, and .pptx drafts or decks.</span>
            </div>
            <button className="ops-primary" type="button" onClick={openWorkbench}>
              <ClipboardList aria-hidden="true" />
              {activeChecklist.status === 'available' ? 'Open workbench' : 'Browse wired checks'}
            </button>
          </section>

          <section className="checklist-history-card">
            <header>
              <h2>Past runs</h2>
              <History aria-hidden="true" />
            </header>
            <p>Review history is loaded live in the workbench so saved results stay tied to real run records.</p>
            <div className="history-preview-row">
              <span className="status-dot conditional" />
              <span>Conditional</span>
              <small>Example verdict style</small>
            </div>
            <div className="history-preview-row">
              <span className="status-dot cleared" />
              <span>Cleared</span>
              <small>Sign-off ready</small>
            </div>
          </section>
        </div>
      </div>

      <div className="review-workbench-heading" ref={workbenchRef}>
        <p className="ops-eyebrow">Live runner</p>
        <h2>B2 review workbench</h2>
        <p>Use the actual review runner for Skeleton Lock, PDRA Meta Review, Internal Red Team, and Revision Lock.</p>
      </div>
      <ReviewForm embedded canSignOff={canSignOff} />
    </ConsolePageFrame>
  );
}

function AlertsView({
  payload,
  themePayload,
  chatNotifications,
  onMarkChatNotificationRead,
  onMarkAllChatNotificationsRead,
  onOpenChatSession,
}: {
  payload: LabStatePayload | null;
  themePayload: ThemeMeetingPayload | null;
  chatNotifications: ChatNotification[];
  onMarkChatNotificationRead: (notificationId: string) => Promise<void>;
  onMarkAllChatNotificationsRead: () => Promise<void>;
  onOpenChatSession: (sessionId: string, notificationId?: string) => void;
}) {
  const [markError, setMarkError] = useState<string | null>(null);
  const [isMarking, setIsMarking] = useState(false);
  const attention = payload?.summary.projectsNeedingAttention || [];
  const themeNotifications = themePayload?.notifications || [];
  const unreadChatNotifications = chatNotifications.filter((notification) => !notification.readAt);
  const readChatNotifications = chatNotifications.filter((notification) => notification.readAt);
  const activeCount = unreadChatNotifications.length + themeNotifications.length + attention.length;

  async function markOne(notificationId: string) {
    try {
      setIsMarking(true);
      setMarkError(null);
      await onMarkChatNotificationRead(notificationId);
    } catch (caught) {
      setMarkError(caught instanceof Error ? caught.message : 'Could not mark notification as read.');
    } finally {
      setIsMarking(false);
    }
  }

  async function markAll() {
    try {
      setIsMarking(true);
      setMarkError(null);
      await onMarkAllChatNotificationsRead();
    } catch (caught) {
      setMarkError(caught instanceof Error ? caught.message : 'Could not mark notifications as read.');
    } finally {
      setIsMarking(false);
    }
  }

  function openChat(notification: ChatNotification) {
    setMarkError(null);
    onOpenChatSession(notification.sessionId, notification.readAt ? undefined : notification.id);
  }

  return (
    <ConsolePageFrame
      title="Alerts"
      subtitle="Calm nudges for status confirmation and agenda preparation"
      badge={
        <span className="prototype-pill alert-pill">
          <Bell aria-hidden="true" />
          {activeCount} active
        </span>
      }
      actions={
        unreadChatNotifications.length ? (
          <button className="ops-secondary" type="button" onClick={() => void markAll()} disabled={isMarking}>
            <Check aria-hidden="true" />
            Mark all read
          </button>
        ) : undefined
      }
    >
      <div className="alerts-list">
        {markError && <div className="form-message error">{markError}</div>}
        {unreadChatNotifications.map((notification) => (
          <article className="alert-item unread-alert" key={notification.id}>
            <Bell aria-hidden="true" />
            <div>
              <strong>{notification.title}</strong>
              <p>{notification.body}</p>
              <small>
                @{notification.actorUsername} · {chatSessionTime(notification.createdAt)}
              </small>
            </div>
            <div className="alert-actions">
              <button
                className="tiny-button"
                type="button"
                onClick={() => openChat(notification)}
                disabled={isMarking}
              >
                <MessageCircle aria-hidden="true" />
                Open chat
              </button>
              <button
                className="tiny-button"
                type="button"
                onClick={() => void markOne(notification.id)}
                disabled={isMarking}
              >
                Mark read
              </button>
            </div>
          </article>
        ))}
        {themeNotifications.map((notification) => (
          <article className="alert-item" key={notification.id}>
            <Bell aria-hidden="true" />
            <div>
              <strong>{notification.title}</strong>
              <p>{notification.body}</p>
            </div>
          </article>
        ))}
        {attention.length ? (
          attention.map((project) => (
            <article className="alert-item" key={project.project}>
              <Bell aria-hidden="true" />
              <div>
                <strong>{titleCase(project.project)}</strong>
                <p>
                  {recommendationLabels[project.derived.recommendation]} suggested for {project.owner}: {evidence(project)}.
                </p>
              </div>
            </article>
          ))
        ) : null}
        {readChatNotifications.length ? (
          <>
            <div className="alerts-section-label">Earlier</div>
            {readChatNotifications.map((notification) => (
              <article className="alert-item read-alert" key={notification.id}>
                <Bell aria-hidden="true" />
                <div>
                  <strong>{notification.title}</strong>
                  <p>{notification.body}</p>
                  <small>
                    @{notification.actorUsername} · {chatSessionTime(notification.createdAt)}
                  </small>
                </div>
                <div className="alert-actions">
                  <button
                    className="tiny-button"
                    type="button"
                    onClick={() => openChat(notification)}
                    disabled={isMarking}
                  >
                    <MessageCircle aria-hidden="true" />
                    Open chat
                  </button>
                </div>
              </article>
            ))}
          </>
        ) : null}
        {!chatNotifications.length && !themeNotifications.length && !attention.length ? (
          <div className="ops-empty">No alerts right now</div>
        ) : null}
      </div>
    </ConsolePageFrame>
  );
}

function draftFromUser(user: ManagedUser): UserDraft {
  const email = profileEmail(user);
  return {
    displayName: user.displayName,
    email: email === '-' ? '' : email,
    avatarUrl: profileAvatarUrl(user),
    role: user.role,
    provisioningStatus: user.provisioningStatus,
    aliasesText: user.aliases.filter((alias) => alias !== email).join(', '),
    temporaryPassword: '',
  };
}

function aliasesFromText(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function profileEmail(user: CurrentUser): string {
  return user.email || user.profile?.email || [...user.aliases, ...(user.profile?.publicInfo || [])].find((item) => item.includes('@')) || '-';
}

function roleLabel(role: CurrentUser['role']) {
  if (role === 'pi') return 'PI';
  if (role === 'administrator') return 'Admin';
  return titleCase(role);
}

function provisioningLabel(value: string) {
  return value === 'profile_only' ? 'Profile only' : titleCase(value);
}

function AdminConfigurationPanel() {
  const [payload, setPayload] = useState<AdminConfigPayload | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settings = payload?.settings || [];
  const configGroups = useMemo(() => groupedConfigSettings(settings), [settings]);
  const changedKeys = settings
    .filter((setting) => drafts[setting.key] !== undefined && drafts[setting.key] !== setting.value)
    .map((setting) => setting.key);

  const applyPayload = useCallback((nextPayload: AdminConfigPayload) => {
    setPayload(nextPayload);
    setDrafts(Object.fromEntries((nextPayload.settings || []).map((setting) => [setting.key, setting.value])));
  }, []);

  const loadConfig = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch('/api/admin/config');
      const body = (await response.json()) as AdminConfigPayload;
      if (!response.ok || !body.settings) {
        throw new Error(body.error || 'Could not load configuration.');
      }
      applyPayload(body);
      setLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load configuration.');
      setLoaded(true);
    }
  }, [applyPayload]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  async function saveConfig() {
    const settingsPatch = Object.fromEntries(
      settings
        .filter((setting) => changedKeys.includes(setting.key))
        .map((setting) => [setting.key, drafts[setting.key] || null]),
    );
    if (!Object.keys(settingsPatch).length) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: settingsPatch }),
      });
      const body = (await response.json()) as AdminConfigPayload;
      if (!response.ok || !body.settings) {
        throw new Error(body.error || 'Could not save configuration.');
      }
      applyPayload(body);
      setMessage('Configuration saved. Restart required for runtime changes.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save configuration.');
    } finally {
      setBusy(false);
    }
  }

  async function resetConfig(key: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { [key]: null } }),
      });
      const body = (await response.json()) as AdminConfigPayload;
      if (!response.ok || !body.settings) {
        throw new Error(body.error || 'Could not reset configuration.');
      }
      applyPayload(body);
      setMessage('Configuration reset. Restart required for runtime changes.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reset configuration.');
    } finally {
      setBusy(false);
    }
  }

  async function requestRestart() {
    setRestartBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/config/restart', { method: 'POST' });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        throw new Error(body.error || 'Could not request restart.');
      }
      setMessage('Restart requested.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not request restart.');
    } finally {
      setRestartBusy(false);
    }
  }

  return (
    <section className="settings-section settings-section-config">
      <div className="settings-section-heading">
        <h2>Configuration</h2>
        <p>Runtime settings, secret status, and service restart controls.</p>
      </div>
      {error && <div className="form-message error">{error}</div>}
      {message && <div className="form-message">{message}</div>}
      {!loaded ? (
        <div className="members-loading">
          <DotMatrixIcon variant="loading" size={24} />
          <span>Loading configuration</span>
        </div>
      ) : (
        <>
          <section className="ops-panel config-panel">
            <div className="ops-panel-head">
              <div>
                <h2>Secrets</h2>
                <p>Values stay in the deployment environment.</p>
              </div>
            </div>
            <div className="config-secret-grid">
              {(payload?.secrets || []).map((secret) => (
                <div className="config-secret" key={secret.key}>
                  <span>{secret.label}</span>
                  <strong className={secret.configured ? 'configured' : 'missing'}>
                    {secret.configured ? 'Configured' : 'Missing'}
                  </strong>
                </div>
              ))}
            </div>
          </section>

          <section className="ops-panel config-panel">
            <div className="ops-panel-head">
              <div>
                <h2>Runtime settings</h2>
                <p>{changedKeys.length ? `${changedKeys.length} pending change(s)` : 'No pending changes'}</p>
              </div>
              <button className="ops-primary" type="button" onClick={() => void saveConfig()} disabled={busy || !changedKeys.length}>
                <Save aria-hidden="true" />
                {busy ? 'Saving' : 'Save changes'}
              </button>
            </div>
            <div className="config-groups">
              {configGroups.map((group) => (
                <section className="config-group" key={group.section}>
                  <h3>{group.label}</h3>
                  {group.settings.map((setting) => (
                    <div className="config-row" key={setting.key}>
                      <div>
                        <strong>{setting.label}</strong>
                        <p>{setting.description}</p>
                        <div className="config-badges">
                          <span className={`config-source source-${setting.source}`}>{setting.source}</span>
                          {setting.restartRequired && <span className="config-restart">Restart required</span>}
                          {setting.status && (
                            <span className={`config-status status-${setting.status.state}`}>{setting.status.detail}</span>
                          )}
                        </div>
                      </div>
                      <div className="config-control">
                        <input
                          type={setting.valueType === 'number' ? 'number' : 'text'}
                          value={drafts[setting.key] ?? ''}
                          onChange={(event) => setDrafts((current) => ({ ...current, [setting.key]: event.target.value }))}
                          placeholder={setting.optional ? 'optional' : undefined}
                        />
                        <button
                          className="tiny-button"
                          type="button"
                          disabled={busy || setting.source !== 'database'}
                          onClick={() => void resetConfig(setting.key)}
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </section>

          <section className="ops-panel config-panel">
            <div className="ops-panel-head config-restart-head">
              <div>
                <h2>Service restart</h2>
                <p>{payload?.restart?.configured ? 'Restart command configured.' : 'Restart command not configured.'}</p>
              </div>
              <button
                className="ops-secondary"
                type="button"
                disabled={restartBusy || !payload?.restart?.configured}
                onClick={() => {
                  if (window.confirm('Request a VioScope service restart?')) {
                    void requestRestart();
                  }
                }}
              >
                <Power aria-hidden="true" />
                {restartBusy ? 'Requesting' : 'Restart'}
              </button>
            </div>
          </section>
        </>
      )}
    </section>
  );
}

function AuditLogSettingsPanel() {
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [days, setDays] = useState<AuditLogDay[]>([]);
  const [fileName, setFileName] = useState(`audit-${day}.jsonl`);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<AuditLogRecord | null>(null);
  const logGroups = useMemo(() => groupedAuditDays(days), [days]);

  const loadLogs = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/audit-log?day=${encodeURIComponent(day)}`);
      const body = (await response.json()) as AuditLogPayload;
      if (!response.ok || !body.logs) {
        throw new Error(body.error || 'Could not load audit log.');
      }
      setLogs(body.logs);
      setDays(body.days || []);
      setFileName(body.fileName || `audit-${day}.jsonl`);
      setLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load audit log.');
      setLoaded(true);
    } finally {
      setBusy(false);
    }
  }, [day]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  return (
    <section className="settings-section settings-section-audit">
      <div className="settings-section-heading">
        <h2>Audit log</h2>
        <p>Administrative trace of account, chat, meeting, notification, and review actions.</p>
      </div>
      <div className="audit-browser">
        <aside className="ops-panel audit-file-list" aria-label="Audit log files">
          <div className="ops-panel-head">
            <div>
              <h2>Log files</h2>
              <p>{days.length} days</p>
            </div>
          </div>
          {!loaded ? (
            <div className="members-loading audit-file-loading">
              <DotMatrixIcon variant="loading" size={22} />
              <span>Loading files</span>
            </div>
          ) : !logGroups.length ? (
            <p className="audit-file-empty">No audit log files yet.</p>
          ) : (
            <div className="audit-file-groups">
              {logGroups.map((group) => (
                <div className="audit-file-group" key={group.key}>
                  <h3>{group.label}</h3>
                  {group.days.map((logDay) => (
                    <button
                      className={logDay.day === day ? 'active' : ''}
                      type="button"
                      key={logDay.day}
                      onClick={() => setDay(logDay.day)}
                    >
                      <FileText aria-hidden="true" />
                      <span>{logDay.fileName}</span>
                      <small>{logDay.count}</small>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </aside>
        <section className="ops-panel audit-panel">
          <div className="ops-panel-head audit-panel-head">
            <div>
              <h2>Daily log</h2>
              <p>{fileName}</p>
            </div>
            <div className="audit-toolbar">
              <label>
                <span>Date</span>
                <input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
              </label>
              <button className="ops-secondary" type="button" onClick={() => void loadLogs()} disabled={busy}>
                <History aria-hidden="true" />
                {busy ? 'Loading' : 'Refresh'}
              </button>
            </div>
          </div>
          {error && <div className="form-message error">{error}</div>}
          {!loaded ? (
            <div className="members-loading">
              <DotMatrixIcon variant="loading" size={24} />
              <span>Loading audit log</span>
            </div>
          ) : !logs.length ? (
            <div className="members-empty audit-empty">
              <ClipboardList aria-hidden="true" />
              <h3>No log entries</h3>
              <p>No audited actions were recorded for this day.</p>
            </div>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table audit-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Summary</th>
                    <th aria-label="JSON details" />
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr
                      className="audit-log-row"
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedLog(log);
                        }
                      }}
                      tabIndex={0}
                    >
                      <td>{chatSessionTime(log.eventTime)}</td>
                      <td>
                        {log.actorUsername ? (
                          <span>
                            {log.actorUsername}
                            {log.actorRole ? <small>{roleLabel(log.actorRole as CurrentUser['role'])}</small> : null}
                          </span>
                        ) : (
                          'System'
                        )}
                      </td>
                      <td className="mono-cell">{log.action}</td>
                      <td className="mono-cell">{log.targetId ? `${log.targetType}/${log.targetId}` : log.targetType}</td>
                      <td>{log.summary || '-'}</td>
                      <td className="audit-json-cell">
                        <button
                          className="tiny-button"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedLog(log);
                          }}
                          title={compactJson(log.metadata)}
                        >
                          <FileText aria-hidden="true" />
                          View JSON
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <p className="settings-footnote">
        The daily filename is for review/export naming; Postgres remains the source of truth for filtering and access control.
      </p>
      {selectedLog && (
        <div className="audit-modal-backdrop" role="presentation" onClick={() => setSelectedLog(null)}>
          <section
            className="audit-json-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="audit-json-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="audit-json-title">Audit entry</h2>
                <p>{selectedLog.action} · {chatSessionTime(selectedLog.eventTime)}</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setSelectedLog(null)}>
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="audit-log-fields">
              <div><span>Actor</span><strong>{selectedLog.actorUsername || 'System'}</strong></div>
              <div><span>Target</span><strong>{selectedLog.targetId ? `${selectedLog.targetType}/${selectedLog.targetId}` : selectedLog.targetType}</strong></div>
              <div><span>Summary</span><strong>{selectedLog.summary || '-'}</strong></div>
            </div>
            <pre className="audit-json-viewer"><code>{highlightedJson(auditLogJson(selectedLog))}</code></pre>
          </section>
        </div>
      )}
    </section>
  );
}

function UsersView({
  user,
  onUserChanged,
  personalDetailsSignal,
  theme,
  setTheme,
  canManageUsers,
}: {
  user: CurrentUser;
  onUserChanged: (user: CurrentUser) => void;
  personalDetailsSignal: number;
  theme: ConsoleTheme;
  setTheme: (theme: ConsoleTheme) => void;
  canManageUsers: boolean;
}) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
  const [userQuery, setUserQuery] = useState('');
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [notificationPrefs, setNotificationPrefs] = useState({
    digest: true,
    deepdive: true,
    checklist: true,
    meeting: true,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState({
    username: '',
    displayName: '',
    email: '',
    role: 'member' as CurrentUser['role'],
    aliasesText: '',
    temporaryPassword: '',
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyCreate, setBusyCreate] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editingUser = users.find((user) => user.id === editingUserId) || null;
  const editingDraft = editingUser ? drafts[editingUser.id] || draftFromUser(editingUser) : null;
  const canViewAudit = user.role === 'administrator';
  const canViewConfig = user.role === 'administrator';

  const filteredUsers = useMemo(() => {
    const query = userQuery.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) => (
      user.displayName.toLowerCase().includes(query) ||
      user.username.toLowerCase().includes(query) ||
      user.role.toLowerCase().includes(query) ||
      user.aliases.some((alias) => alias.toLowerCase().includes(query))
    ));
  }, [userQuery, users]);
  const activeUserCount = users.filter((user) => user.provisioningStatus !== 'disabled').length;

  const applyUsers = useCallback((nextUsers: ManagedUser[]) => {
    setUsers(nextUsers);
    setDrafts(
      Object.fromEntries(nextUsers.map((user) => [user.id, draftFromUser(user)])),
    );
  }, []);

  useEffect(() => {
    if (!canManageUsers) {
      setUsersLoaded(true);
      return undefined;
    }

    let cancelled = false;

    async function loadUsers() {
      try {
        setError(null);
        const response = await fetch('/api/users');
        const body = (await response.json()) as UsersPayload;
        if (!response.ok || !body.users) {
          throw new Error(body.error || 'Could not load users.');
        }
        if (!cancelled) {
          applyUsers(body.users);
          setUsersLoaded(true);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not load users.');
          setUsersLoaded(true);
        }
      }
    }

    void loadUsers();
    return () => {
      cancelled = true;
    };
  }, [applyUsers, canManageUsers]);

  useEffect(() => {
    if (
      (!canManageUsers && settingsTab === 'users') ||
      (!canViewAudit && settingsTab === 'audit') ||
      (!canViewConfig && settingsTab === 'config')
    ) {
      setSettingsTab('general');
    }
  }, [canManageUsers, canViewAudit, canViewConfig, settingsTab]);

  useEffect(() => {
    setSettingsTab('general');
  }, [personalDetailsSignal]);

  function setDraft(userId: string, patch: Partial<UserDraft>) {
    setDrafts((current) => ({ ...current, [userId]: { ...current[userId], ...patch } }));
  }

  function chooseEditAvatar(event: FormEvent<HTMLInputElement>, userId: string) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file.');
      return;
    }
    if (file.size > 500_000) {
      setError('Choose an avatar under 500 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setDraft(userId, { avatarUrl: reader.result });
      }
    };
    reader.readAsDataURL(file);
  }

  async function saveUser(user: ManagedUser, patch: Partial<UserDraft> = {}) {
    const draft = { ...(drafts[user.id] || draftFromUser(user)), ...patch };
    if (!draft) return;
    setBusyId(user.id);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: draft.displayName,
          role: draft.role,
          provisioningStatus: draft.provisioningStatus,
          email: draft.email,
          aliases: aliasesFromText(draft.aliasesText),
          avatarUrl: draft.avatarUrl,
          temporaryPassword: draft.temporaryPassword,
        }),
      });
      const body = (await response.json()) as UsersPayload;
      if (!response.ok || !body.user) {
        throw new Error(body.error || 'Could not save user.');
      }
      setUsers((current) => current.map((nextUser) => (nextUser.id === body.user?.id ? body.user : nextUser)));
      setDrafts((current) => ({ ...current, [body.user!.id]: draftFromUser(body.user!) }));
      setMessage(`Saved ${body.user.displayName}.`);
      setEditingUserId(null);
      setActionUserId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save user.');
    } finally {
      setBusyId(null);
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyCreate(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: createDraft.username,
          displayName: createDraft.displayName,
          email: createDraft.email,
          role: createDraft.role,
          aliases: aliasesFromText(createDraft.aliasesText),
          temporaryPassword: createDraft.temporaryPassword,
        }),
      });
      const body = (await response.json()) as UsersPayload;
      if (!response.ok || !body.users) {
        throw new Error(body.error || 'Could not create user.');
      }
      applyUsers(body.users);
      setCreateDraft({ username: '', displayName: '', email: '', role: 'member', aliasesText: '', temporaryPassword: '' });
      setCreateOpen(false);
      setMessage('Created user with a forced password reset.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create user.');
    } finally {
      setBusyCreate(false);
    }
  }

  const userActions = (
    <div className="users-toolbar">
      <label className="ops-search">
        <Search aria-hidden="true" />
        <input
          value={userQuery}
          onChange={(event) => setUserQuery(event.target.value)}
          placeholder="Search members..."
          aria-label="Search members"
        />
      </label>
      <button
        className="ops-primary"
        type="button"
        onClick={() => {
          setActionUserId(null);
          setCreateOpen(true);
        }}
      >
        <Plus aria-hidden="true" />
        Add member
      </button>
    </div>
  );

  const notificationRows: Array<{ key: keyof typeof notificationPrefs; title: string; desc: string }> = [
    { key: 'digest', title: 'Weekly digest', desc: 'A Monday summary of lab activity by email.' },
    { key: 'deepdive', title: 'Deep-dive suggestions', desc: 'When VioScope flags a project for a meeting deep dive.' },
    { key: 'checklist', title: 'Checklist results', desc: 'When an advisory verdict is ready on your document.' },
    { key: 'meeting', title: 'Meeting reminders', desc: 'A nudge before each theme meeting cutoff.' },
  ];
  const integrationRows = [
    { mark: 'OL', name: 'Overleaf', desc: 'Import LaTeX drafts for checklist runs.', status: 'Backlog' },
  ];
  const settingsBadge = settingsTab === 'users'
    ? 'Admin / PI'
    : settingsTab === 'audit' || settingsTab === 'config'
      ? 'Admin'
      : titleCase(settingsTab);

  return (
    <ConsolePageFrame
      title="Settings"
      className="users-page settings-page"
      wide
      badge={
        <span className={settingsTab === 'users' || settingsTab === 'audit' || settingsTab === 'config' ? 'prototype-pill admin-access' : 'prototype-pill'}>
          <Settings aria-hidden="true" />
          {settingsBadge}
        </span>
      }
    >
      <div className="settings-layout">
        <aside className="settings-sidebar" aria-label="Settings sections">
          <button className={settingsTab === 'general' ? 'active' : ''} type="button" onClick={() => setSettingsTab('general')}>
            <Settings aria-hidden="true" />
            <span>General</span>
          </button>
          <button className={settingsTab === 'notifications' ? 'active' : ''} type="button" onClick={() => setSettingsTab('notifications')}>
            <Bell aria-hidden="true" />
            <span>Notifications</span>
          </button>
          <button className={settingsTab === 'integrations' ? 'active' : ''} type="button" onClick={() => setSettingsTab('integrations')}>
            <FileText aria-hidden="true" />
            <span>Integrations</span>
          </button>
          {(canManageUsers || canViewAudit || canViewConfig) && (
            <>
              <div className="settings-sidebar-rule" />
              <div className="settings-sidebar-label">Administration</div>
              {canManageUsers && (
                <button className={settingsTab === 'users' ? 'active' : ''} type="button" onClick={() => setSettingsTab('users')}>
                  <Users aria-hidden="true" />
                  <span>User management</span>
                  <KeyRound className="settings-lock-icon" aria-hidden="true" />
                </button>
              )}
              {canViewConfig && (
                <button className={settingsTab === 'config' ? 'active' : ''} type="button" onClick={() => setSettingsTab('config')}>
                  <Settings aria-hidden="true" />
                  <span>Configuration</span>
                  <KeyRound className="settings-lock-icon" aria-hidden="true" />
                </button>
              )}
              {canViewAudit && (
                <button className={settingsTab === 'audit' ? 'active' : ''} type="button" onClick={() => setSettingsTab('audit')}>
                  <History aria-hidden="true" />
                  <span>Audit log</span>
                  <KeyRound className="settings-lock-icon" aria-hidden="true" />
                </button>
              )}
            </>
          )}
          <button className={settingsTab === 'about' ? 'active' : ''} type="button" onClick={() => setSettingsTab('about')}>
            <ShieldCheck aria-hidden="true" />
            <span>About</span>
          </button>
        </aside>

        <div className={`settings-main ${settingsTab === 'users' || settingsTab === 'audit' || settingsTab === 'config' ? 'settings-main-wide' : ''}`}>
          {settingsTab === 'general' ? (
            <div className="settings-section">
              <div className="settings-section-heading">
                <h2>General</h2>
                <p>Your profile and how VioScope behaves for you.</p>
              </div>
              <AccountDetailsPanel user={user} onUserChanged={onUserChanged} />
              <section className="ops-panel settings-panel">
                <div className="ops-panel-head">
                  <div>
                    <h2>Appearance</h2>
                    <p>Personal display settings for this browser.</p>
                  </div>
                </div>
                <div className="preference-row">
                  <div>
                    <strong>Theme</strong>
                    <p>Choose how VioScope appears on this device.</p>
                  </div>
                  <div className="prototype-segmented" role="group" aria-label="Theme preference">
                    <button className={theme === 'light' ? 'selected' : ''} type="button" onClick={() => setTheme('light')}>
                      Light
                    </button>
                    <button className={theme === 'dark' ? 'selected' : ''} type="button" onClick={() => setTheme('dark')}>
                      Dark
                    </button>
                    <button className={theme === 'system' ? 'selected' : ''} type="button" onClick={() => setTheme('system')}>
                      System
                    </button>
                  </div>
                </div>
                <div className="preference-row">
                  <div>
                    <strong>Default landing area</strong>
                    <p>Where VioScope opens when you sign in.</p>
                  </div>
                  <span className="settings-select-like">Dashboard</span>
                </div>
              </section>
            </div>
          ) : settingsTab === 'notifications' ? (
            <section className="settings-section">
              <div className="settings-section-heading">
                <h2>Notifications</h2>
                <p>Choose what reaches you, and where.</p>
              </div>
              <div className="ops-panel settings-list-panel">
                {notificationRows.map((row) => {
                  const enabled = notificationPrefs[row.key];
                  return (
                    <div className="settings-list-row" key={row.key}>
                      <div>
                        <strong>{row.title}</strong>
                        <p>{row.desc}</p>
                      </div>
                      <button
                        className={`settings-switch ${enabled ? 'on' : ''}`}
                        type="button"
                        aria-label={`Toggle ${row.title}`}
                        aria-pressed={enabled}
                        onClick={() => setNotificationPrefs((current) => ({ ...current, [row.key]: !current[row.key] }))}
                      >
                        <span />
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="settings-footnote">In-app alerts always appear under Alerts; email and external push stay optional.</p>
            </section>
          ) : settingsTab === 'integrations' ? (
            <section className="settings-section">
              <div className="settings-section-heading">
                <h2>Integrations</h2>
                <p>Track the Overleaf draft import planned for checklist runs.</p>
              </div>
              <div className="ops-panel settings-list-panel">
                {integrationRows.map((row) => (
                  <div className="settings-list-row integration-row" key={row.name}>
                    <span className="integration-mark">{row.mark}</span>
                    <div>
                      <strong>{row.name}</strong>
                      <p>{row.desc}</p>
                    </div>
                    <span className="integration-status">{row.status}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : settingsTab === 'config' ? (
            <AdminConfigurationPanel />
          ) : settingsTab === 'audit' ? (
            <AuditLogSettingsPanel />
          ) : settingsTab === 'about' ? (
            <section className="settings-section">
              <div className="settings-section-heading">
                <h2>About</h2>
                <p>VioScope, the VIOS lab assistant and operations console.</p>
              </div>
              <div className="ops-panel about-panel">
                <div><span>Version</span><strong>0.6.0 · internal preview</strong></div>
                <div><span>Wiki index</span><strong>Configured from DATASTORE_DIR</strong></div>
                <div><span>Maintained by</span><strong>VIOS Lab · School of Engineering</strong></div>
              </div>
              <p className="settings-footnote">VioScope is advisory: it surfaces evidence and citations, and a human always decides.</p>
            </section>
          ) : (
            <div className="settings-section settings-section-members">
              <div className="settings-members-head">
                <span className="prototype-pill admin-access">
                  <KeyRound aria-hidden="true" />
                  Visible to PIs & admins only
                </span>
                {userActions}
              </div>
      {error && <div className="form-message error">{error}</div>}
      {message && <div className="form-message">{message}</div>}

      <section className="ops-panel users-panel members-panel">
        <div className="ops-panel-head">
          <div>
            <h2>Lab members</h2>
            <p>{activeUserCount} active · {users.length} total · {filteredUsers.length} shown</p>
          </div>
          <span className="prototype-pill">
            <KeyRound aria-hidden="true" />
            Credentials issued here
          </span>
        </div>

        {!usersLoaded ? (
          <div className="members-loading">
            <DotMatrixIcon variant="loading" size={24} />
            <span>Loading members</span>
          </div>
        ) : !users.length ? (
          <div className="members-empty">
            <Users aria-hidden="true" />
            <h3>No members yet</h3>
            <p>Add the lab's researchers, organizers, and PIs. New local accounts receive a temporary password and must reset it on first login.</p>
            <button
              className="ops-primary"
              type="button"
              onClick={() => {
                setActionUserId(null);
                setCreateOpen(true);
              }}
            >
              <Plus aria-hidden="true" />
              Add the first member
            </button>
          </div>
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table prototype-user-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last active</th>
                  <th aria-label="Row actions" />
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const dimmed = user.provisioningStatus === 'disabled';
                  return (
                    <tr key={user.id} className={dimmed ? 'dimmed' : ''}>
                      <td>
                        <div className="member-cell">
                          <AvatarCircle user={user} className="member-avatar" />
                          <span>{user.displayName}</span>
                        </div>
                      </td>
                      <td className="mono-cell">{user.username}</td>
                      <td>{profileEmail(user)}</td>
                      <td>
                        <span className={`role-pill role-${user.role}`}>{roleLabel(user.role)}</span>
                      </td>
                      <td>
                        <span className={`provisioning-pill provisioning-${user.provisioningStatus}`}>
                          <span />
                          {provisioningLabel(user.provisioningStatus)}
                        </span>
                      </td>
                      <td>{user.lastLoginAt ? formatDate(user.lastLoginAt.slice(0, 10)) : user.hasPassword ? 'Never' : 'Not active'}</td>
                      <td className="row-actions-cell">
                        <button
                          className="row-action-button"
                          type="button"
                          aria-label={`Actions for ${user.displayName}`}
                          onClick={() => setActionUserId((current) => (current === user.id ? null : user.id))}
                        >
                          <MoreVertical aria-hidden="true" />
                        </button>
                        {actionUserId === user.id && (
                          <div className="row-menu">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingUserId(user.id);
                                setActionUserId(null);
                              }}
                            >
                              <Pencil aria-hidden="true" />
                              Edit details
                            </button>
                            <button
                              className={user.provisioningStatus === 'disabled' ? '' : 'danger'}
                              type="button"
                              disabled={busyId === user.id}
                              onClick={() => saveUser(user, { provisioningStatus: user.provisioningStatus === 'disabled' ? 'active' : 'disabled' })}
                            >
                              <Power aria-hidden="true" />
                              {user.provisioningStatus === 'disabled' ? 'Enable member' : 'Disable member'}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!filteredUsers.length && (
                  <tr>
                    <td colSpan={7}>No members match this search.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="members-footnote">
        Roles govern what each person sees. Administrators and PIs can delegate lab roles; members cannot change their own role.
      </p>
            </div>
          )}
        </div>
      </div>

      {createOpen && (
        <div className="users-modal-backdrop" role="presentation" onClick={() => setCreateOpen(false)}>
          <form className="users-modal" onSubmit={createUser} onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>Add a member</h2>
              <button type="button" aria-label="Close" onClick={() => setCreateOpen(false)}>
                <X aria-hidden="true" />
              </button>
            </header>
            <label>
              <span>Username</span>
              <input
                value={createDraft.username}
                onChange={(event) => setCreateDraft((current) => ({ ...current, username: event.target.value }))}
                placeholder="username"
              />
            </label>
            <label>
              <span>Display name</span>
              <input
                value={createDraft.displayName}
                onChange={(event) => setCreateDraft((current) => ({ ...current, displayName: event.target.value }))}
                placeholder="Display name"
              />
            </label>
            <label>
              <span>Email</span>
              <input
                type="email"
                value={createDraft.email}
                onChange={(event) => setCreateDraft((current) => ({ ...current, email: event.target.value }))}
                placeholder="optional on first login"
              />
            </label>
            <label>
              <span>Role</span>
              <div className="role-picker">
                {userRoleOptions.map((role) => (
                  <button
                    key={role}
                    className={createDraft.role === role ? 'selected' : ''}
                    type="button"
                    onClick={() => setCreateDraft((current) => ({ ...current, role }))}
                  >
                    {roleLabel(role)}
                  </button>
                ))}
              </div>
            </label>
            <label>
              <span>Aliases</span>
              <input
                value={createDraft.aliasesText}
                onChange={(event) => setCreateDraft((current) => ({ ...current, aliasesText: event.target.value }))}
                placeholder="aliases, comma-separated"
              />
            </label>
            <label>
              <span>Temporary password</span>
              <input
                type="password"
                value={createDraft.temporaryPassword}
                onChange={(event) => setCreateDraft((current) => ({ ...current, temporaryPassword: event.target.value }))}
                placeholder="defaults to username"
              />
            </label>
            <p>New local accounts must change the temporary password on first login.</p>
            <p>If no temporary password is set, the username is used once for first login.</p>
            <footer>
              <button className="ops-secondary" type="button" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button className="ops-primary" type="submit" disabled={busyCreate}>
                <Plus aria-hidden="true" />
                {busyCreate ? 'Creating' : 'Create member'}
              </button>
            </footer>
          </form>
        </div>
      )}

      {editingUser && editingDraft && (
        <div className="users-modal-backdrop" role="presentation" onClick={() => setEditingUserId(null)}>
          <form
            className="users-modal user-edit-modal"
            onSubmit={(event) => {
              event.preventDefault();
              void saveUser(editingUser);
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h2>Edit member</h2>
              <button type="button" aria-label="Close" onClick={() => setEditingUserId(null)}>
                <X aria-hidden="true" />
              </button>
            </header>
            <section className="modal-fieldset">
              <h3>Profile details</h3>
              <div className="account-avatar-row">
                <span className="user-avatar large">
                  {editingDraft.avatarUrl ? <img src={editingDraft.avatarUrl} alt="" /> : initials(editingDraft.displayName || editingUser.username)}
                </span>
                <label className="avatar-upload avatar-upload-icon" aria-label="Upload avatar" title="Upload avatar">
                  <Upload aria-hidden="true" />
                  <input accept="image/*" type="file" onChange={(event) => chooseEditAvatar(event, editingUser.id)} />
                </label>
              </div>
              <label>
                <span>Display name</span>
                <input
                  value={editingDraft.displayName}
                  onChange={(event) => setDraft(editingUser.id, { displayName: event.target.value })}
                />
              </label>
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={editingDraft.email}
                  onChange={(event) => setDraft(editingUser.id, { email: event.target.value })}
                  placeholder="optional until first login"
                />
              </label>
              <label>
                <span>Aliases</span>
                <input
                  value={editingDraft.aliasesText}
                  onChange={(event) => setDraft(editingUser.id, { aliasesText: event.target.value })}
                  placeholder="aliases"
                />
              </label>
            </section>
            <section className="modal-fieldset">
              <h3>Access control</h3>
              <p>Role and status are delegated here; members cannot change these from their account settings.</p>
              <label>
                <span>Role</span>
                <div className="role-picker">
                  {userRoleOptions.map((role) => (
                    <button
                      key={role}
                      className={editingDraft.role === role ? 'selected' : ''}
                      type="button"
                      onClick={() => setDraft(editingUser.id, { role })}
                    >
                      {roleLabel(role)}
                    </button>
                  ))}
                </div>
              </label>
              <label>
                <span>Status</span>
                <select
                  value={editingDraft.provisioningStatus}
                  onChange={(event) => setDraft(editingUser.id, { provisioningStatus: event.target.value })}
                >
                  {provisioningStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {provisioningLabel(status)}
                    </option>
                  ))}
                </select>
              </label>
            </section>
            <label>
              <span>Temporary password</span>
              <input
                type="password"
                value={editingDraft.temporaryPassword}
                onChange={(event) => setDraft(editingUser.id, { temporaryPassword: event.target.value })}
                placeholder={editingUser.hasPassword ? 'reset password' : 'required to activate'}
              />
            </label>
            <footer>
              <button className="ops-secondary" type="button" onClick={() => setEditingUserId(null)}>
                Cancel
              </button>
              <button className="ops-primary" type="submit" disabled={busyId === editingUser.id}>
                <Save aria-hidden="true" />
                {busyId === editingUser.id ? 'Saving' : 'Save changes'}
              </button>
            </footer>
          </form>
        </div>
      )}
    </ConsolePageFrame>
  );
}

export function OperationsConsole() {
  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [theme, setTheme] = useState<ConsoleTheme>('light');
  const [themeReady, setThemeReady] = useState(false);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [personalDetailsSignal, setPersonalDetailsSignal] = useState(0);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [payload, setPayload] = useState<LabStatePayload | null>(null);
  const [labStateLoading, setLabStateLoading] = useState(false);
  const [themePayload, setThemePayload] = useState<ThemeMeetingPayload | null>(null);
  const [themeMeetingsLoading, setThemeMeetingsLoading] = useState(false);
  const [chatNotifications, setChatNotifications] = useState<ChatNotification[]>([]);
  const [openChatThreadId, setOpenChatThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectView = useCallback((view: ActiveView, replace = false) => {
    setActiveView(view);
    writeViewToUrl(view, replace);
  }, []);

  useEffect(() => {
    setActiveView(activeViewFromSearch(window.location.search));
    const syncViewFromUrl = () => setActiveView(activeViewFromSearch(window.location.search));
    window.addEventListener('popstate', syncViewFromUrl);
    return () => window.removeEventListener('popstate', syncViewFromUrl);
  }, []);

  useEffect(() => {
    const storedTheme = readStoredTheme();
    setTheme(storedTheme);
    applyConsoleTheme(storedTheme);
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    applyConsoleTheme(theme);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('vios-theme', theme);
    }
  }, [theme, themeReady]);

  useEffect(() => {
    if (!themeReady || theme !== 'system' || typeof window === 'undefined') return undefined;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const syncSystemTheme = () => applyConsoleTheme('system');
    media.addEventListener('change', syncSystemTheme);
    return () => media.removeEventListener('change', syncSystemTheme);
  }, [theme, themeReady]);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await fetch('/api/auth/me');
        const body = (await response.json()) as AuthPayload;
        if (!response.ok) {
          if (response.status !== 401) {
            setAuthError(body.error || 'Could not read session.');
          }
          return;
        }

        if (!cancelled) {
          setUser(body.user || null);
        }
      } catch (caught) {
        if (!cancelled) {
          setAuthError(caught instanceof Error ? caught.message : 'Could not read session.');
        }
      } finally {
        if (!cancelled) {
          setAuthChecked(true);
        }
      }
    }

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadThemeMeetings = useCallback(async () => {
    setThemeMeetingsLoading(true);
    try {
      const response = await fetch('/api/theme-meetings');
      const nextPayload = (await response.json()) as ThemeMeetingPayload | { error?: string };
      if (!response.ok) {
        throw new Error('error' in nextPayload && nextPayload.error ? nextPayload.error : 'Could not load theme meetings.');
      }
      setThemePayload(nextPayload as ThemeMeetingPayload);
    } finally {
      setThemeMeetingsLoading(false);
    }
  }, []);

  const loadChatNotifications = useCallback(async () => {
    const response = await fetch('/api/notifications');
    const nextPayload = (await response.json()) as NotificationsPayload;
    if (!response.ok) {
      throw new Error(nextPayload.error || 'Could not load notifications.');
    }
    setChatNotifications(nextPayload.notifications || []);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!user || user.passwordResetRequired) {
      setPayload(null);
      setLabStateLoading(false);
      setThemePayload(null);
      setThemeMeetingsLoading(false);
      setChatNotifications([]);
      return () => {
        cancelled = true;
      };
    }

    async function loadLabState() {
      setLabStateLoading(true);
      try {
        const response = await fetch('/api/lab-state');
        const nextPayload = (await response.json()) as LabStatePayload | { error?: string };
        if (!response.ok) {
          throw new Error('error' in nextPayload && nextPayload.error ? nextPayload.error : 'Could not load lab state.');
        }
        if (!cancelled) {
          setPayload(nextPayload as LabStatePayload);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not load lab state.');
        }
      } finally {
        if (!cancelled) {
          setLabStateLoading(false);
        }
      }
    }

    void loadLabState();
    void loadThemeMeetings().catch((caught) => {
      if (!cancelled) {
        setError(caught instanceof Error ? caught.message : 'Could not load theme meetings.');
      }
    });
    void loadChatNotifications().catch((caught) => {
      if (!cancelled) {
        setError(caught instanceof Error ? caught.message : 'Could not load notifications.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadChatNotifications, loadThemeMeetings, user]);

  useEffect(() => {
    if (user && !user.passwordResetRequired && activeView === 'alerts') {
      void loadChatNotifications().catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Could not load notifications.');
      });
    }
  }, [activeView, loadChatNotifications, user]);

  async function markChatNotificationRead(notificationId: string) {
    const response = await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationId }),
    });
    const body = (await response.json()) as NotificationsPayload;
    if (!response.ok) {
      throw new Error(body.error || 'Could not mark notification as read.');
    }
    setChatNotifications(body.notifications || []);
  }

  async function markAllChatNotificationsRead() {
    const response = await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    const body = (await response.json()) as NotificationsPayload;
    if (!response.ok) {
      throw new Error(body.error || 'Could not mark notifications as read.');
    }
    setChatNotifications(body.notifications || []);
  }

  const handleChatThreadOpened = useCallback(() => {
    setOpenChatThreadId(null);
  }, []);

  function openChatSessionFromNotification(sessionId: string, notificationId?: string) {
    setOpenChatThreadId(sessionId);
    selectView('chat');
    if (notificationId) {
      void markChatNotificationRead(notificationId).catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Could not mark notification as read.');
      });
    }
  }

  const topNavItems = useMemo(
    () => [
      { id: 'chat' as const, label: 'Chat', icon: MessageCircle },
      { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
      { id: 'meeting' as const, label: 'Meeting', icon: CalendarDays },
      { id: 'checklists' as const, label: 'Checklists', icon: ClipboardList },
    ],
    [],
  );

  const unreadChatNotificationCount = chatNotifications.filter((notification) => !notification.readAt).length;
  const activeAlertCount =
    unreadChatNotificationCount +
    (themePayload?.notifications.length || 0) +
    (payload?.summary.projectsNeedingAttention.length || 0);

  const bottomNavItems = useMemo(
    () => [
      { id: 'users' as const, label: 'Settings', icon: Settings },
      { id: 'alerts' as const, label: 'Alerts', icon: Bell, hasDot: activeAlertCount > 0 },
    ],
    [activeAlertCount],
  );

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
    setAccountMenuOpen(false);
    setPayload(null);
    setThemePayload(null);
    setChatNotifications([]);
    setError(null);
    selectView('dashboard', true);
  }

  if (!authChecked) {
    return <AuthLoading />;
  }

  if (!user) {
    return <LoginView onLogin={setUser} initialError={authError} />;
  }

  if (user.passwordResetRequired) {
    return <ChangePasswordView user={user} onChanged={setUser} onLogout={logout} />;
  }

  return (
    <main className="console-app">
      <header className="console-topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <div>
            <strong>VioScope</strong>
            <small>VIOS Lab</small>
          </div>
        </div>
        <div className="account-block">
          <button
            className="theme-toggle"
            type="button"
            onClick={() => setTheme((current) => (resolveConsoleTheme(current) === 'dark' ? 'light' : 'dark'))}
            aria-label="Toggle light or dark theme"
            title="Toggle theme"
          >
            {resolveConsoleTheme(theme) === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </button>
          <button
            className="account-summary"
            type="button"
            onClick={() => setAccountMenuOpen((current) => !current)}
            aria-expanded={accountMenuOpen}
            aria-haspopup="menu"
          >
            <div>
              <strong>{user.displayName}</strong>
              <small>{roleLabel(user.role)}</small>
            </div>
            <AvatarCircle user={user} />
            <ChevronDown className="account-menu-chevron" aria-hidden="true" />
          </button>
          {accountMenuOpen && (
            <div className="account-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountMenuOpen(false);
                  setPersonalDetailsSignal((current) => current + 1);
                  selectView('users');
                }}
              >
                <Settings aria-hidden="true" />
                Settings
              </button>
              <button type="button" role="menuitem" onClick={logout}>
                <LogOut aria-hidden="true" />
                Log out
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="console-body">
        <nav className="console-rail" aria-label="Primary">
          {topNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={activeView === item.id ? 'active' : ''}
                type="button"
                onClick={() => selectView(item.id)}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
          <div className="rail-spacer" />
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={activeView === item.id ? 'active' : ''}
                type="button"
                onClick={() => selectView(item.id)}
              >
                <span className="rail-icon-wrap">
                  <Icon aria-hidden="true" />
                  {'hasDot' in item && item.hasDot && <span className="rail-dot" aria-hidden="true" />}
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="console-content">
          {error && (
            <div className="ops-notice error">
              <AlertCircle aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          {activeView === 'dashboard' && (
            <DashboardView payload={payload} loading={labStateLoading} viewer={user} />
          )}
          {activeView === 'chat' && (
            <ChatView viewer={user} openThreadId={openChatThreadId} onOpenThreadHandled={handleChatThreadOpened} />
          )}
          {activeView === 'meeting' && (
            <MeetingView payload={themePayload} loading={themeMeetingsLoading} onThemeMeetingChanged={loadThemeMeetings} viewer={user} />
          )}
          {activeView === 'checklists' && <ChecklistsView canSignOff={canSeeAllRole(user.role)} />}
          {activeView === 'alerts' && (
            <AlertsView
              payload={payload}
              themePayload={themePayload}
              chatNotifications={chatNotifications}
              onMarkChatNotificationRead={markChatNotificationRead}
              onMarkAllChatNotificationsRead={markAllChatNotificationsRead}
              onOpenChatSession={openChatSessionFromNotification}
            />
          )}
          {activeView === 'users' && (
            <UsersView
              user={user}
              onUserChanged={setUser}
              personalDetailsSignal={personalDetailsSignal}
              theme={theme}
              setTheme={setTheme}
              canManageUsers={user.role === 'administrator' || user.role === 'pi'}
            />
          )}
        </div>
      </div>
    </main>
  );
}
