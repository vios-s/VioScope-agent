'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import {
  AlertCircle,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardList,
  Download,
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
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Settings,
  Sun,
  Upload,
  X,
  Trash2,
  Users,
} from 'lucide-react';
import { DotMatrixIcon } from './dot-matrix-icon';
import { ReviewForm } from './review-form';
import type {
  ProjectStatus,
} from '../src/mastra/state/schema';
import type {
  ThemeMeetingConfig,
  ThemeMeetingNotification,
  ThemeMeetingPlan,
  ThemeUpdateType,
} from '../src/mastra/theme-meetings/schema';
import { vioscopeChatUiConfig } from '../src/mastra/agents/vioscope.chat-ui.config';

type ActiveView = 'briefing' | 'projects' | 'chat' | 'meeting' | 'checklists' | 'alerts' | 'users';
type ProjectsMode = 'member' | 'pi';
type ChatMessageStatus = 'thinking' | 'answer' | 'refusal';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  actorUserId?: string;
  actorUsername?: string;
  actorDisplayName?: string;
  actorAvatarUrl?: string;
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

type ProjectLifecycle = 'active' | 'paused' | 'finished' | 'archived';
type ProjectUpdateType = 'progress' | 'note' | 'decision' | 'blocker' | 'artifact';
type ProjectAccessReason = 'owner' | 'coordinator' | 'pi_admin';
type ProjectTrack = 'A' | 'B';
type ProjectSlotRecommendation = 'deep_dive' | 'milestone_check' | 'strategic_slot' | 'none';
type UserPosition = 'pi' | 'student' | 'postdoc' | 'software_engineer' | 'visitor';

type ManagedProjectArtifact = {
  id: string;
  title: string;
  kind: string;
  path: string | null;
  summary: string;
  artifactKey: string;
  isCurrent: boolean;
  sourceUpdateId: string | null;
  uploadedByUsername: string | null;
  createdAt: string;
};

type ManagedProjectUpdateComment = {
  id: string;
  updateId: string;
  byUsername: string;
  text: string;
  createdAt: string;
};

type ManagedProjectUpdate = {
  id: string;
  date: string;
  byUsername: string;
  type: ProjectUpdateType;
  text: string;
  stage: number | null;
  stageProgress: number | null;
  status: ProjectStatus | null;
  blocker: string | null;
  target: string | null;
  milestone: boolean;
  artifactIds: string[];
  comments: ManagedProjectUpdateComment[];
  createdAt: string;
};

type ManagedProject = {
  id: string;
  project: string;
  title: string;
  ownerUsername: string;
  collaborators: string[];
  track: string;
  stage: number;
  stageProgress: number;
  lifecycle: ProjectLifecycle;
  status: ProjectStatus;
  stageSince: string | null;
  lastUpdate: string | null;
  blocker: string | null;
  target: string | null;
  venue: string | null;
  submissionDeadline: string | null;
  watchPath: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  artifacts: ManagedProjectArtifact[];
  updates: ManagedProjectUpdate[];
  needsUpdate: boolean;
  overdue: boolean;
  attentionReason: string | null;
  recommendation: ProjectSlotRecommendation;
  access: {
    canEdit: boolean;
    canArchive: boolean;
    canAddUpdate: boolean;
    canComment: boolean;
    reason: ProjectAccessReason;
  };
};

type ProjectsPayload = {
  source?: 'project_manager';
  projects?: ManagedProject[];
  project?: ManagedProject;
  error?: string;
};

type ProjectPlanningItem = {
  id: string;
  title: string;
  project: string;
  ownerUsername: string;
  stage: number;
  stageProgress: number;
  status: ProjectStatus;
  target: string | null;
  blocker: string | null;
  lastUpdate: string | null;
  recommendation: ProjectSlotRecommendation;
  attentionReason: string | null;
  progressText: string | null;
  updatedAt: string | null;
};

type ProjectPlanningReport = {
  generatedAt: string;
  cycleStart: string;
  cycleDays: number;
  projectCount: number;
  activeProjectCount: number;
  attentionItems: ProjectPlanningItem[];
  updatedProjects: ProjectPlanningItem[];
  markdown: string;
};

type ProjectPlanningPayload = {
  report?: ProjectPlanningReport;
  error?: string;
};

type ProjectDraft = {
  id?: string;
  project: string;
  title: string;
  ownerUsername: string;
  collaboratorsText: string;
  track: ProjectTrack;
  stage: string;
  stageProgress: string;
  lifecycle: ProjectLifecycle;
  status: ProjectStatus;
  stageSince: string;
  lastUpdate: string;
  blocker: string;
  target: string;
  venue: string;
  submissionDeadline: string;
  watchPath: string;
  notes: string;
};

type ProjectTimelineDraft = {
  type: ProjectUpdateType;
  date: string;
  text: string;
  stage: string;
  stageProgress: string;
  status: ProjectStatus;
  blocker: string;
  target: string;
  milestone: boolean;
  artifactFile: File | null;
  artifactFileName: string;
};

type ThemeMeetingOverviewPlan = {
  meeting_date: string;
  timezone: string;
  cycle_group: string;
  generated_at: string;
  meetings: {
    theme_id: string;
    title: string;
    time: string;
    duration_minutes: number;
    coordinator: string;
    member_count: number;
    submitted_count: number;
    planned_minutes: number;
    agenda_count: number;
    overbooked: boolean;
  }[];
};

type ThemeMeetingPayload = {
  plan: ThemeMeetingPlan;
  overviewPlan?: ThemeMeetingOverviewPlan;
  submissionPlan?: ThemeMeetingPlan | null;
  pastPlans?: ThemeMeetingOverviewPlan[];
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
  position: UserPosition | null;
  provisioningStatus: string;
  sourceProfileId: string | null;
  aliases: string[];
  notificationPreferences: NotificationPreferences;
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

type NotificationPreferenceTopic =
  | 'chat_mentions'
  | 'project_progress_reminders'
  | 'theme_meeting_reminders'
  | 'project_planning_brief'
  | 'checklist_results';

type NotificationPreferenceChannels = {
  web: boolean;
  email: boolean;
};

type NotificationPreferences = Record<NotificationPreferenceTopic, NotificationPreferenceChannels>;

type ManagedUser = CurrentUser & {
  source: string;
  hasPassword: boolean;
};

type UserDraft = {
  displayName: string;
  email: string;
  avatarUrl: string;
  role: CurrentUser['role'];
  position: UserPosition | '';
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
  valueType: 'string' | 'number' | 'path' | 'time' | 'weekday';
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

type ThemeMeetingSettingsUser = {
  id: string;
  username: string;
  displayName: string;
  role: CurrentUser['role'];
  provisioningStatus: string;
};

type ThemeMeetingSettingsPayload = {
  config?: ThemeMeetingConfig;
  users?: ThemeMeetingSettingsUser[];
  access?: {
    canEditGlobal: boolean;
    editableThemeIds: string[];
  };
  paths?: {
    config: string;
  };
  error?: string;
};

type AdminConfigPayload = {
  settings?: AdminConfigSetting[];
  restart?: { configured: boolean };
  error?: string;
};

type ConsoleTheme = 'light' | 'dark' | 'system';
type ConsoleAccentTheme = 'cyan' | 'aegean' | 'blue' | 'green' | 'indigo' | 'orange' | 'red';
type ConsoleFontTheme = 'public' | 'serif' | 'mulish' | 'quicksand' | 'mali' | 'jura';
type ConsoleThemeSettings = {
  mode: ConsoleTheme;
  accent: ConsoleAccentTheme;
  font: ConsoleFontTheme;
};
type SettingsTab = 'general' | 'notifications' | 'integrations' | 'themeMeeting' | 'users' | 'config' | 'audit' | 'about';
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

const notificationPreferenceRows: Array<{
  key: NotificationPreferenceTopic;
  title: string;
  desc: string;
  emailDisabled?: boolean;
}> = [
  {
    key: 'chat_mentions',
    title: 'Chat mentions',
    desc: 'When someone shares a chat with @username.',
    emailDisabled: true,
  },
  {
    key: 'project_progress_reminders',
    title: 'Project progress reminders',
    desc: 'Bi-weekly project update nudges before theme meetings.',
  },
  {
    key: 'theme_meeting_reminders',
    title: 'Theme meeting reminders',
    desc: 'Agenda, cutoff, and meeting-related reminders.',
  },
  {
    key: 'project_planning_brief',
    title: 'Project planning brief',
    desc: 'Attention items and updated project summaries for PI/admin review.',
  },
  {
    key: 'checklist_results',
    title: 'Checklist results',
    desc: 'When an advisory checklist or review result is ready.',
  },
];

function defaultNotificationPreferences(): NotificationPreferences {
  return {
    chat_mentions: { web: true, email: false },
    project_progress_reminders: { web: true, email: true },
    theme_meeting_reminders: { web: true, email: true },
    project_planning_brief: { web: true, email: true },
    checklist_results: { web: true, email: true },
  };
}

function normalizedNotificationPreferences(input?: Partial<NotificationPreferences>): NotificationPreferences {
  const defaults = defaultNotificationPreferences();
  if (!input) return defaults;
  for (const row of notificationPreferenceRows) {
    const current = input[row.key];
    if (current) {
      defaults[row.key] = {
        web: typeof current.web === 'boolean' ? current.web : defaults[row.key].web,
        email: row.emailDisabled ? false : typeof current.email === 'boolean' ? current.email : defaults[row.key].email,
      };
    }
  }
  defaults.chat_mentions.email = false;
  return defaults;
}

const statusLabels: Record<ProjectStatus, string> = {
  on_track: 'On track',
  blocked: 'Blocked',
  stale: 'Stale',
  needs_input: 'Needs input',
};

const lifecycleLabels: Record<ProjectLifecycle, string> = {
  active: 'Active',
  paused: 'Paused',
  finished: 'Finished',
  archived: 'Archived',
};

const projectUpdateTypeLabels: Record<ProjectUpdateType, string> = {
  progress: 'Progress',
  note: 'Note',
  decision: 'Decision',
  blocker: 'Blocker',
  artifact: 'Artifact',
};

const projectTrackLabels: Record<ProjectTrack, string> = {
  A: 'Track A',
  B: 'Track B',
};

const projectArtifactMaxBytes = 20 * 1024 * 1024;

const stageLabels: Record<number, string> = {
  1: '1: idea/proposal',
  2: '2: design/planning',
  3: '3: experiments/build',
  4: '4: writing/packaging',
  5: '5: submission/finish',
};

const projectSlotLabels: Record<ProjectSlotRecommendation, string> = {
  deep_dive: 'Deep dive',
  milestone_check: 'Milestone check',
  strategic_slot: 'Strategic slot',
  none: 'No slot',
};

const updateTypeLabels: Record<ThemeUpdateType, string> = {
  nothing_to_report: 'Nothing to report',
  deep_dive: 'Deep dive',
  milestone_check: 'Milestone check',
  strategic_slot: 'Strategic slot',
};

const updateTypeOptionLabels: Record<ThemeUpdateType, string> = {
  nothing_to_report: 'Nothing to report (0 min)',
  deep_dive: 'Deep dive (20-30 min)',
  milestone_check: 'Milestone check (10 min)',
  strategic_slot: 'Strategic slot (paper or idea)',
};

const themeMeetingSlotTypes: ThemeUpdateType[] = ['nothing_to_report', 'deep_dive', 'milestone_check', 'strategic_slot'];
const themeMeetingReminderRows = [
  { name: 'first_reminder', label: 'First reminder' },
  { name: 'gentle_missing_update_reminder', label: 'Missing-only reminder' },
  { name: 'agenda_cutoff', label: 'Agenda cutoff' },
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

const userPermissionOptions: CurrentUser['role'][] = ['administrator', 'pi', 'organizer', 'member'];
const userPositionOptions: UserPosition[] = ['pi', 'student', 'postdoc', 'software_engineer', 'visitor'];
const provisioningStatusOptions = ['profile_only', 'active', 'disabled'];
const consoleAccentOptions: Array<{ id: ConsoleAccentTheme; label: string; color: string }> = [
  { id: 'cyan', label: 'Cyan', color: '#219f94' },
  { id: 'aegean', label: 'Aegean', color: '#387478' },
  { id: 'blue', label: 'Blue', color: '#1363df' },
  { id: 'green', label: 'Green', color: '#8cba51' },
  { id: 'indigo', label: 'Indigo', color: '#655d8a' },
  { id: 'orange', label: 'Orange', color: '#f59f00' },
  { id: 'red', label: 'Red', color: '#f73859' },
];
const consoleFontOptions: Array<{ id: ConsoleFontTheme; label: string; fontFamily: string }> = [
  { id: 'public', label: 'Public Sans', fontFamily: '"Public Sans", sans-serif' },
  { id: 'serif', label: 'Source Serif', fontFamily: '"Source Serif 4", serif' },
  { id: 'mulish', label: 'Mulish', fontFamily: 'Mulish, sans-serif' },
  { id: 'quicksand', label: 'Quicksand', fontFamily: 'Quicksand, sans-serif' },
  { id: 'mali', label: 'Mali', fontFamily: 'Mali, cursive' },
  { id: 'jura', label: 'Jura', fontFamily: 'Jura, sans-serif' },
];
const rowMenuWidth = 190;
const rowMenuHeight = 88;
const rowMenuGutter = 10;
const refusalPattern = /could not find|cannot find|not enough|insufficient|knowledge gap|limited to VIOS lab|non-lab topics/i;
const activeViews: ActiveView[] = ['briefing', 'projects', 'chat', 'meeting', 'checklists', 'alerts', 'users'];
const viewQueryParam = 'view';

function activeViewFromSearch(search: string): ActiveView {
  const view = new URLSearchParams(search).get(viewQueryParam);
  if (view === 'dashboard') return 'projects';
  return activeViews.includes(view as ActiveView) ? (view as ActiveView) : 'briefing';
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

function slugifyProjectName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 96);
}

function generatedWatchPath(ownerUsername: string, slug: string) {
  return slug ? `project://${ownerUsername}/${slug}` : '';
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

function currentProjectArtifacts(project: ManagedProject) {
  return project.artifacts.filter((artifact) => artifact.isCurrent);
}

function daysSinceDate(value: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

function projectDraftFromProject(project: ManagedProject | null, viewer: CurrentUser): ProjectDraft {
  const ownerUsername = project?.ownerUsername || viewer.username;
  const projectSlug = project?.project || '';
  return {
    id: project?.id,
    project: projectSlug,
    title: project?.title || '',
    ownerUsername,
    collaboratorsText: project?.collaborators.join(', ') || '',
    track: project?.track === 'B' ? 'B' : 'A',
    stage: String(project?.stage || 1),
    stageProgress: String(project?.stageProgress ?? 0),
    lifecycle: project?.lifecycle || 'active',
    status: project?.status || 'on_track',
    stageSince: project?.stageSince || new Date().toISOString().slice(0, 10),
    lastUpdate: project?.lastUpdate || '',
    blocker: project?.blocker || '',
    target: project?.target || '',
    venue: project?.venue || '',
    submissionDeadline: project?.submissionDeadline || '',
    watchPath: project?.watchPath || generatedWatchPath(ownerUsername, projectSlug),
    notes: project?.notes || '',
  };
}

function projectRequestBody(draft: ProjectDraft) {
  const projectSlug = slugifyProjectName(draft.project || draft.title);
  return {
    project: projectSlug,
    title: draft.title,
    ownerUsername: draft.ownerUsername,
    collaborators: collaboratorTokens(draft.collaboratorsText),
    track: draft.track,
    stage: Number(draft.stage),
    stageProgress: Number(draft.stageProgress || 0),
    lifecycle: draft.lifecycle,
    status: draft.status,
    stageSince: draft.stageSince || null,
    lastUpdate: draft.lastUpdate || null,
    blocker: draft.blocker || null,
    target: draft.target || null,
    venue: draft.venue || null,
    submissionDeadline: draft.submissionDeadline || null,
    watchPath: generatedWatchPath(draft.ownerUsername, projectSlug) || null,
    notes: draft.notes || null,
  };
}

function defaultTimelineDraft(project?: ManagedProject | null): ProjectTimelineDraft {
  return {
    type: 'progress',
    date: new Date().toISOString().slice(0, 10),
    text: '',
    stage: String(project?.stage || 1),
    stageProgress: String(project?.stageProgress ?? 0),
    status: project?.status || 'on_track',
    blocker: project?.blocker || '',
    target: project?.target || '',
    milestone: false,
    artifactFile: null,
    artifactFileName: '',
  };
}

function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function inferArtifactKind(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (!ext) return 'other';
  if (['ppt', 'pptx', 'key'].includes(ext)) return 'slides';
  if (['tex', 'bib'].includes(ext)) return 'latex';
  if (['zip', 'tar', 'gz'].includes(ext)) return 'zip';
  if (['md', 'pdf', 'doc', 'docx', 'txt'].includes(ext)) return 'document';
  if (['py', 'ts', 'tsx', 'js', 'jsx', 'ipynb'].includes(ext)) return 'code';
  return 'other';
}

function collaboratorTokens(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function activeCollaboratorToken(value: string) {
  const parts = value.split(',');
  return (parts.at(-1) || '').trim().toLowerCase();
}

function withSelectedCollaborator(value: string, username: string) {
  const parts = value.split(',');
  parts[parts.length - 1] = ` ${username}`;
  return `${parts.map((part) => part.trim()).filter(Boolean).join(', ')}, `;
}

function projectNeedsAttention(project: ManagedProject) {
  return project.needsUpdate || project.recommendation !== 'none' || project.status !== 'on_track' || Boolean(project.blocker);
}

function projectEvidence(project: ManagedProject) {
  const signals = [
    project.attentionReason,
    project.status !== 'on_track' ? statusLabels[project.status].toLowerCase() : null,
    project.blocker ? 'blocker present' : null,
    daysSinceDate(project.lastUpdate) !== null && (daysSinceDate(project.lastUpdate) || 0) > 14 ? 'stale update' : null,
  ].filter(Boolean);
  return signals.join(', ') || 'no risk signals';
}

function projectPlanningLine(item: ProjectPlanningItem) {
  return `${item.title} / ${item.ownerUsername} / ${projectSlotLabels[item.recommendation]} / stage ${item.stage} (${item.stageProgress}%)`;
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

const auditLogTimeZone = 'Europe/London';

const auditLogDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: auditLogTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function auditLogDateKey(value: Date | string = new Date()) {
  const parts = Object.fromEntries(
    auditLogDateFormatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function auditLogTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: auditLogTimeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value));
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
  return new Intl.DateTimeFormat('en-GB', { timeZone: auditLogTimeZone, month: 'long', year: 'numeric' }).format(new Date(`${monthKey}-15T12:00:00Z`));
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
const configWeekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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

const dialogFocusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function focusableDialogElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(dialogFocusableSelector)).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.tabIndex !== -1;
  });
}

function trapCustomDialogFocus(event: KeyboardEvent<HTMLElement>, onClose: () => void) {
  if (event.target instanceof HTMLElement && event.target.closest('dialog[open]')) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    onClose();
    return;
  }

  if (event.key !== 'Tab') return;
  const focusable = focusableDialogElements(event.currentTarget);
  if (!focusable.length) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function useCustomDialogFocus<T extends HTMLElement>(open: boolean, initialFocusRef: RefObject<T | null>) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => initialFocusRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, [open, initialFocusRef]);
}

function ConfirmDialog({
  id,
  open,
  title,
  message,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: {
  id: string;
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = `${id}-title`;
  const messageId = `${id}-message`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!dialog.open) dialog.showModal();
      window.requestAnimationFrame(() => cancelRef.current?.focus());
    } else if (dialog.open) {
      dialog.close();
      previousFocusRef.current?.focus();
    }
  }, [open]);

  useEffect(() => () => {
    if (dialogRef.current?.open) dialogRef.current.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form method="dialog" className="confirm-dialog-card">
        <header>
          <h2 id={titleId}>{title}</h2>
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} aria-label="Cancel">
            <X aria-hidden="true" />
          </button>
        </header>
        <p id={messageId}>{message}</p>
        <footer>
          <button className="ops-secondary" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="ops-primary danger-confirm" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working' : confirmLabel}
          </button>
        </footer>
      </form>
    </dialog>
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

function ChatActorAvatar({ message, viewer }: { message: ChatMessage; viewer: CurrentUser }) {
  const name = message.actorDisplayName || message.actorUsername || 'Teammate';
  const avatarUrl = message.actorAvatarUrl || (message.actorUserId === viewer.id ? profileAvatarUrl(viewer) : '');
  return (
    <span className="user-avatar chat-message-avatar">
      {avatarUrl ? <img src={avatarUrl} alt="" /> : initials(name)}
    </span>
  );
}

function chatActorLabel(message: ChatMessage, viewer: CurrentUser) {
  if (message.actorUserId === viewer.id) return 'You';
  const name = message.actorDisplayName || message.actorUsername || 'Teammate';
  return message.actorUsername ? `${name} (@${message.actorUsername})` : name;
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

function ChecklistTagPill({ tag }: { tag: ChecklistTag }) {
  return <span className={`checklist-tag tag-${tag.toLowerCase()}`}>{tag}</span>;
}

function ConsolePageFrame({
  title,
  subtitle,
  actions,
  tabs,
  children,
  className = '',
  wide = false,
}: {
  title: string;
  subtitle?: string;
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
        <div className="auth-panel">
          <div className="auth-brand">
            <img className="brand-mark auth-mark" src="/art/VIOS_icon.jpg" alt="" aria-hidden="true" />
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

function normalizeConsoleThemeSettings(input: Partial<ConsoleThemeSettings> | null | undefined): ConsoleThemeSettings {
  return {
    mode: input?.mode === 'dark' || input?.mode === 'light' || input?.mode === 'system' ? input.mode : 'system',
    accent: consoleAccentOptions.some((option) => option.id === input?.accent) ? input!.accent! : 'aegean',
    font: consoleFontOptions.some((option) => option.id === input?.font) ? input!.font! : 'public',
  };
}

function themeSettingsStorageKey(userId?: string) {
  return `vios-theme-settings:${userId || 'default'}`;
}

function applyConsoleAppearance(settings: ConsoleThemeSettings) {
  if (typeof document === 'undefined') return;
  applyConsoleTheme(settings.mode);
  document.documentElement.dataset.accentTheme = settings.accent;
  document.documentElement.dataset.consoleFont = settings.font;
}

function readStoredThemeSettings(userId?: string): ConsoleThemeSettings {
  if (typeof window === 'undefined') return normalizeConsoleThemeSettings(null);
  const stored = window.localStorage.getItem(themeSettingsStorageKey(userId));
  if (stored) {
    try {
      return normalizeConsoleThemeSettings(JSON.parse(stored) as Partial<ConsoleThemeSettings>);
    } catch {
      return normalizeConsoleThemeSettings(null);
    }
  }
  const legacyTheme = window.localStorage.getItem('vios-theme');
  return normalizeConsoleThemeSettings({
    mode: legacyTheme === 'dark' || legacyTheme === 'light' || legacyTheme === 'system' ? legacyTheme : 'system',
  });
}

function saveStoredThemeSettings(userId: string, settings: ConsoleThemeSettings) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(themeSettingsStorageKey(userId), JSON.stringify(settings));
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

function ProjectCard({
  project,
  onOpenDetails,
  onOpenProgress,
}: {
  project: ManagedProject;
  onOpenDetails: (project: ManagedProject) => void;
  onOpenProgress: (project: ManagedProject) => void;
}) {
  const currentArtifacts = currentProjectArtifacts(project);
  const age = formatAge(daysSinceDate(project.lastUpdate));
  return (
    <article className="project-card">
      <div className="project-card-head">
        <div>
          <span className="track-chip">Track {project.track}</span>
          <h3>{project.title || titleCase(project.project)}</h3>
        </div>
        <StatusChip status={project.status} />
      </div>
      <div className="stage-row">
        <span>
          Stage {project.stage} / 5 - {project.stageProgress}% - {lifecycleLabels[project.lifecycle]}
        </span>
        <StageBar stage={project.stage} />
      </div>
      <div className="project-meta-row">
        <span>Target</span>
        <strong>{project.target || 'Not set'}</strong>
      </div>
      <div className="project-meta-row">
        <span>Last update</span>
        <strong>{age === 'today' ? 'Today' : `${age} ago`}</strong>
      </div>
      <div className="project-meta-row">
        <span>Artifacts</span>
        <strong>{currentArtifacts.length} current / {project.artifacts.length} total</strong>
      </div>
      <div className="project-meta-row">
        <span>Meeting slot</span>
        <strong>{projectSlotLabels[project.recommendation]}</strong>
      </div>
      {project.blocker && <p className="project-blocker">{project.blocker}</p>}
      <div className="button-row">
        <button
          className="ops-secondary icon-only-button"
          type="button"
          onClick={() => onOpenDetails(project)}
          aria-label={`Project details for ${project.title}`}
          title="Project details"
        >
          <FileText aria-hidden="true" />
        </button>
        <button
          className="ops-primary icon-only-button"
          type="button"
          onClick={() => onOpenProgress(project)}
          aria-label={`Progress update for ${project.title}`}
          title="Progress update"
        >
          <Plus aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function CollaboratorInput({
  value,
  onChange,
  users,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  users: MentionableUser[];
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const token = activeCollaboratorToken(value);
  const existing = new Set(collaboratorTokens(value).map((item) => item.toLowerCase()));
  const suggestions = users
    .filter((user) => !existing.has(user.username.toLowerCase()))
    .filter((user) => {
      if (!token) return true;
      return user.username.toLowerCase().includes(token) || user.displayName.toLowerCase().includes(token);
    })
    .slice(0, 5);

  return (
    <label className={['collaborator-field', className].filter(Boolean).join(' ')}>
      <span>Collaborators</span>
      <input
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        onChange={(event) => onChange(event.target.value)}
        placeholder="yuyang, external collaborator"
      />
      {focused && suggestions.length > 0 && (
        <div className="collaborator-suggestions">
          {suggestions.map((user) => (
            <button key={user.id} type="button" onMouseDown={() => onChange(withSelectedCollaborator(value, user.username))}>
              <strong>{user.displayName}</strong>
              <span>@{user.username}</span>
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

function ProjectEditorModal({
  project,
  viewer,
  collaboratorUsers,
  existingProjects,
  onClose,
  onSaved,
}: {
  project: ManagedProject | null;
  viewer: CurrentUser;
  collaboratorUsers: MentionableUser[];
  existingProjects: ManagedProject[];
  onClose: () => void;
  onSaved: (project: ManagedProject) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => projectDraftFromProject(project, viewer));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const isNew = !project;
  const canEditOwner = canSeeAllRole(viewer.role);
  const titleId = 'project-editor-title';
  useCustomDialogFocus(true, closeButtonRef);

  useEffect(() => {
    setDraft(projectDraftFromProject(project, viewer));
    setError(null);
  }, [project, viewer]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const nextSlug = slugifyProjectName(draft.project || draft.title);
      const duplicate = existingProjects.find(
        (existing) =>
          existing.id !== project?.id &&
          existing.ownerUsername.toLowerCase() === draft.ownerUsername.toLowerCase() &&
          existing.title.trim().toLowerCase() === draft.title.trim().toLowerCase(),
      );
      if (!draft.title.trim()) {
        throw new Error('Full project name is required.');
      }
      if (!nextSlug) {
        throw new Error('Project slug could not be generated from this name.');
      }
      if (duplicate) {
        throw new Error('This owner already has a project with the same full project name.');
      }
      const response = await fetch(isNew ? '/api/projects' : `/api/projects/${project.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectRequestBody(draft)),
      });
      const body = (await response.json()) as ProjectsPayload;
      if (!response.ok || !body.project) {
        throw new Error(body.error || 'Could not save project.');
      }
      await onSaved(body.project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save project.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="users-modal-backdrop" role="presentation">
      <form
        className="users-modal user-edit-modal project-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
        onKeyDown={(event) => trapCustomDialogFocus(event, onClose)}
      >
        <header>
          <div>
            <h2 id={titleId}>{isNew ? 'Add project' : 'Edit project'}</h2>
            <p>{isNew ? 'Create a visible project record.' : project.title}</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close project editor">
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="modal-fieldset">
          <h3>Identity</h3>
          <label>
            <span>Full project name</span>
            <input
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                  project: isNew ? slugifyProjectName(event.target.value) : current.project,
                  watchPath: isNew
                    ? generatedWatchPath(current.ownerUsername, slugifyProjectName(event.target.value))
                    : current.watchPath,
                }))
              }
              placeholder="Toy segmentation with robust ablation"
            />
          </label>
          <label>
            <span>Slug</span>
            <input
              value={slugifyProjectName(draft.project || draft.title)}
              placeholder="toy-segmentation"
              disabled
            />
          </label>
          <label>
            <span>Owner</span>
            <input
              value={draft.ownerUsername}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  ownerUsername: event.target.value,
                  watchPath: generatedWatchPath(event.target.value, slugifyProjectName(current.project || current.title)),
                }))
              }
              disabled={!canEditOwner}
            />
          </label>
          <CollaboratorInput
            value={draft.collaboratorsText}
            users={collaboratorUsers}
            onChange={(value) => setDraft((current) => ({ ...current, collaboratorsText: value }))}
          />
        </div>

        <div className="modal-fieldset">
          <h3>Project details</h3>
          <label>
            <span>Track</span>
            <select value={draft.track} onChange={(event) => setDraft((current) => ({ ...current, track: event.target.value as ProjectTrack }))}>
              {(Object.keys(projectTrackLabels) as ProjectTrack[]).map((track) => (
                <option key={track} value={track}>
                  {projectTrackLabels[track]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Lifecycle</span>
            <select
              value={draft.lifecycle}
              onChange={(event) => setDraft((current) => ({ ...current, lifecycle: event.target.value as ProjectLifecycle }))}
            >
              {(Object.keys(lifecycleLabels) as ProjectLifecycle[]).map((lifecycle) => (
                <option key={lifecycle} value={lifecycle}>
                  {lifecycleLabels[lifecycle]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Venue</span>
            <input
              value={draft.venue}
              onChange={(event) => setDraft((current) => ({ ...current, venue: event.target.value }))}
              placeholder="NeurIPS"
              list="venue-hints"
            />
            <datalist id="venue-hints">
              {['NeurIPS', 'ICML', 'ICLR', 'CVPR', 'ECCV', 'AAAI', 'ToyConf'].map((venue) => (
                <option key={venue} value={venue} />
              ))}
            </datalist>
          </label>
          <label>
            <span>Submission deadline</span>
            <input
              type="date"
              value={draft.submissionDeadline}
              onChange={(event) => setDraft((current) => ({ ...current, submissionDeadline: event.target.value }))}
            />
          </label>
        </div>

        <div className="modal-fieldset full">
          <h3>Notes and links</h3>
          <label>
            <span>Watch path</span>
            <input
              value={generatedWatchPath(draft.ownerUsername, slugifyProjectName(draft.project || draft.title))}
              disabled
            />
          </label>
          <label>
            <span>Notes</span>
            <textarea
              rows={4}
              value={draft.notes}
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
            />
          </label>
        </div>

        {error && <div className="form-message error">{error}</div>}
        <footer>
          <button className="ops-secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="ops-primary" type="submit" disabled={busy}>
            <Save aria-hidden="true" />
            {busy ? 'Saving' : 'Save changes'}
          </button>
        </footer>
      </form>
    </div>
  );
}

function ProjectDetailModal({
  project,
  viewer,
  collaboratorUsers,
  existingProjects,
  initialMode,
  onClose,
  onSaved,
  onChanged,
  onArchive,
  onUnarchive,
}: {
  project: ManagedProject;
  viewer: CurrentUser;
  collaboratorUsers: MentionableUser[];
  existingProjects: ManagedProject[];
  initialMode: 'details' | 'progress';
  onClose: () => void;
  onSaved: (project: ManagedProject) => Promise<void>;
  onChanged: (project: ManagedProject) => Promise<void>;
  onArchive: (project: ManagedProject) => Promise<void>;
  onUnarchive: (project: ManagedProject) => Promise<void>;
}) {
  const [mode, setMode] = useState<'details' | 'progress'>(initialMode);
  const [draft, setDraft] = useState(() => defaultTimelineDraft(project));
  const [editDraft, setEditDraft] = useState(() => projectDraftFromProject(project, viewer));
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [artifactToRemove, setArtifactToRemove] = useState<ManagedProjectArtifact | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleId = 'project-detail-title';
  const currentArtifacts = currentProjectArtifacts(project);
  const oldArtifacts = project.artifacts.filter((artifact) => !artifact.isCurrent);
  const canComment = project.access.canComment && (canSeeAllRole(viewer.role) || project.access.reason !== 'coordinator');
  useCustomDialogFocus(true, closeButtonRef);

  useEffect(() => {
    setEditDraft(projectDraftFromProject(project, viewer));
    setDraft(defaultTimelineDraft(project));
    setMode(initialMode);
    setError(null);
  }, [initialMode, project, viewer]);

  useEffect(() => {
    setArtifactToRemove(null);
  }, [project.id]);

  function postUpdateWithProgress(formData: FormData): Promise<ProjectsPayload> {
    return new Promise((resolvePromise, rejectPromise) => {
      const request = new XMLHttpRequest();
      request.open('POST', `/api/projects/${project.id}/updates`);
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setUploadProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        }
      };
      request.onload = () => {
        const body = JSON.parse(request.responseText || '{}') as ProjectsPayload;
        if (request.status >= 200 && request.status < 300) {
          resolvePromise(body);
        } else {
          rejectPromise(new Error(body.error || 'Could not add project update.'));
        }
      };
      request.onerror = () => rejectPromise(new Error('Artifact upload failed.'));
      request.send(formData);
    });
  }

  async function submitProjectEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('edit');
    setError(null);
    try {
      const duplicate = existingProjects.find(
        (existing) =>
          existing.id !== project.id &&
          existing.ownerUsername.toLowerCase() === editDraft.ownerUsername.toLowerCase() &&
          existing.title.trim().toLowerCase() === editDraft.title.trim().toLowerCase(),
      );
      if (!editDraft.title.trim()) {
        throw new Error('Full project name is required.');
      }
      if (duplicate) {
        throw new Error('This owner already has a project with the same full project name.');
      }
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectRequestBody(editDraft)),
      });
      const body = (await response.json()) as ProjectsPayload;
      if (!response.ok || !body.project) {
        throw new Error(body.error || 'Could not save project.');
      }
      await onSaved(body.project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save project.');
    } finally {
      setBusy(null);
    }
  }

  async function submitUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('update');
    setUploadProgress(draft.artifactFile ? 0 : null);
    setError(null);
    try {
      if (draft.type === 'progress' && countWords(draft.text) > 50) {
        throw new Error('Progress update must be 50 words or fewer.');
      }
      const body = draft.artifactFile
        ? await postUpdateWithProgress((() => {
            const formData = new FormData();
            formData.set('type', draft.type);
            if (draft.date) formData.set('date', draft.date);
            formData.set('text', draft.text);
            formData.set('stage', draft.stage);
            formData.set('stageProgress', draft.stageProgress);
            formData.set('status', draft.status);
            formData.set('blocker', draft.blocker);
            formData.set('target', draft.target);
            if (draft.milestone) formData.set('milestone', 'true');
            formData.set('artifactFile', draft.artifactFile);
            return formData;
          })())
        : (await fetch(`/api/projects/${project.id}/updates`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: draft.type,
              date: draft.date || null,
              text: draft.text,
              stage: Number(draft.stage),
              stageProgress: Number(draft.stageProgress),
              status: draft.status,
              blocker: draft.blocker || null,
              target: draft.target || null,
              milestone: draft.milestone,
              artifact: null,
            }),
          }).then(async (response) => {
            const responseBody = (await response.json()) as ProjectsPayload;
            if (!response.ok) throw new Error(responseBody.error || 'Could not add project update.');
            return responseBody;
      }));
      if (!body.project) throw new Error(body.error || 'Could not add project update.');
      setDraft(defaultTimelineDraft(body.project));
      setUploadProgress(null);
      await onChanged(body.project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add project update.');
    } finally {
      setBusy(null);
      setUploadProgress(null);
    }
  }

  async function redigestArtifact(artifact: ManagedProjectArtifact) {
    setBusy(`digest:${artifact.id}`);
    setError(null);
    try {
      const response = await fetch(`/api/project-artifacts/${artifact.id}/digest`, { method: 'POST' });
      const body = (await response.json()) as ProjectsPayload;
      if (!response.ok || !body.project) {
        throw new Error(body.error || 'Could not regenerate artifact digest.');
      }
      await onChanged(body.project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not regenerate artifact digest.');
    } finally {
      setBusy(null);
    }
  }

  async function removeArtifact(artifact: ManagedProjectArtifact) {
    setBusy(`remove:${artifact.id}`);
    setError(null);
    try {
      const response = await fetch(`/api/project-artifacts/${artifact.id}`, { method: 'DELETE' });
      const body = (await response.json()) as ProjectsPayload;
      if (!response.ok || !body.project) {
        throw new Error(body.error || 'Could not remove artifact.');
      }
      setArtifactToRemove(null);
      await onChanged(body.project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove artifact.');
    } finally {
      setBusy(null);
    }
  }

  async function submitComment(updateId: string) {
    const text = commentDrafts[updateId]?.trim();
    if (!text) return;
    setBusy(updateId);
    setError(null);
    try {
      const response = await fetch(`/api/project-updates/${updateId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const body = (await response.json()) as ProjectsPayload;
      if (!response.ok || !body.project) {
        throw new Error(body.error || 'Could not add comment.');
      }
      setCommentDrafts((current) => ({ ...current, [updateId]: '' }));
      await onChanged(body.project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add comment.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="users-modal-backdrop" role="presentation">
      <div
        className="users-modal user-edit-modal project-modal project-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => trapCustomDialogFocus(event, onClose)}
      >
        <header>
          <div>
            <h2 id={titleId}>{project.title}</h2>
            <p>{project.ownerUsername} / Track {project.track} / Stage {project.stage} ({project.stageProgress}%)</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close project details">
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="ops-segmented project-modal-tabs" role="group" aria-label="Project modal section">
          <button className={mode === 'details' ? 'selected' : ''} type="button" onClick={() => setMode('details')}>
            <FileText aria-hidden="true" />
            Details
          </button>
          <button className={mode === 'progress' ? 'selected' : ''} type="button" onClick={() => setMode('progress')}>
            <Plus aria-hidden="true" />
            Progress update
          </button>
        </div>

        {mode === 'details' && (
          <div className="project-modal-two-column project-details-layout">
            {project.access.canEdit ? (
          <form className="project-manage-form" onSubmit={submitProjectEdit}>
            <label className="full">
              <span>Full project name</span>
              <input
                value={editDraft.title}
                onChange={(event) => setEditDraft((current) => ({ ...current, title: event.target.value }))}
              />
            </label>
            <label>
              <span>Slug</span>
              <input value={project.project} disabled />
            </label>
            <label>
              <span>Owner</span>
              <input
                value={editDraft.ownerUsername}
                disabled={!canSeeAllRole(viewer.role)}
                onChange={(event) =>
                  setEditDraft((current) => ({
                    ...current,
                    ownerUsername: event.target.value,
                    watchPath: generatedWatchPath(event.target.value, project.project),
                  }))
                }
              />
            </label>
            <CollaboratorInput
              value={editDraft.collaboratorsText}
              users={collaboratorUsers}
              className="full"
              onChange={(value) => setEditDraft((current) => ({ ...current, collaboratorsText: value }))}
            />
            <label>
              <span>Track</span>
              <select value={editDraft.track} onChange={(event) => setEditDraft((current) => ({ ...current, track: event.target.value as ProjectTrack }))}>
                {(Object.keys(projectTrackLabels) as ProjectTrack[]).map((track) => (
                  <option key={track} value={track}>
                    {projectTrackLabels[track]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Lifecycle</span>
              <select value={editDraft.lifecycle} onChange={(event) => setEditDraft((current) => ({ ...current, lifecycle: event.target.value as ProjectLifecycle }))}>
                {(Object.keys(lifecycleLabels) as ProjectLifecycle[]).map((lifecycle) => (
                  <option key={lifecycle} value={lifecycle}>
                    {lifecycleLabels[lifecycle]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Venue</span>
              <input value={editDraft.venue} onChange={(event) => setEditDraft((current) => ({ ...current, venue: event.target.value }))} />
            </label>
            <label>
              <span>Deadline</span>
              <input
                type="date"
                value={editDraft.submissionDeadline}
                onChange={(event) => setEditDraft((current) => ({ ...current, submissionDeadline: event.target.value }))}
              />
            </label>
            <label className="full">
              <span>Watch path</span>
              <input value={generatedWatchPath(editDraft.ownerUsername, project.project)} disabled />
            </label>
            <label className="full">
              <span>Notes</span>
              <textarea rows={3} value={editDraft.notes} onChange={(event) => setEditDraft((current) => ({ ...current, notes: event.target.value }))} />
            </label>
            {error && <div className="form-message error full">{error}</div>}
            <div className="button-row full">
              <button className="ops-primary" type="submit" disabled={busy === 'edit'}>
                <Save aria-hidden="true" />
                {busy === 'edit' ? 'Saving' : 'Save project'}
              </button>
              {project.access.canArchive && project.lifecycle !== 'archived' && (
                <button className="ops-secondary" type="button" onClick={() => void onArchive(project)}>
                  <X aria-hidden="true" />
                  Archive
                </button>
              )}
              {project.access.canArchive && project.lifecycle === 'archived' && (
                <button className="ops-secondary" type="button" onClick={() => void onUnarchive(project)}>
                  <RotateCcw aria-hidden="true" />
                  Unarchive
                </button>
              )}
            </div>
          </form>
            ) : (
          <div className="project-detail-grid">
            <div>
              <span>Lifecycle</span>
              <strong>{lifecycleLabels[project.lifecycle]}</strong>
            </div>
            <div>
              <span>Status</span>
              <StatusChip status={project.status} />
            </div>
            <div>
              <span>Stage progress</span>
              <strong>{project.stageProgress}%</strong>
            </div>
            <div>
              <span>Venue</span>
              <strong>{project.venue || 'Not set'}</strong>
            </div>
            <div>
              <span>Deadline</span>
              <strong>{formatDate(project.submissionDeadline)}</strong>
            </div>
            <div>
              <span>Collaborators</span>
              <strong>{project.collaborators.join(', ') || 'None'}</strong>
            </div>
            <div>
              <span>Watch path</span>
              <strong>{project.watchPath || 'Not set'}</strong>
            </div>
          </div>
            )}

        <section className="project-artifact-panel">
          <div className="ops-panel-head">
            <div>
              <h2>Artifacts</h2>
              <p>Current summaries are what the agent reads by default.</p>
            </div>
            <FileText aria-hidden="true" />
          </div>
          <div className="artifact-list">
            {currentArtifacts.length ? (
              currentArtifacts.map((artifact) => (
                <div key={artifact.id} className="artifact-row">
                  <div>
                    <strong>{artifact.title}</strong>
                    <small>{artifact.kind} / current</small>
                  </div>
                  <p>{artifact.summary || 'No summary yet'}</p>
                  <div className="artifact-actions">
                    {artifact.path && (
                      <a
                        className="ops-secondary icon-only-button"
                        href={`/api/project-artifacts/${artifact.id}/download`}
                        aria-label={`Download ${artifact.title}`}
                        title="Download artifact"
                      >
                        <Download aria-hidden="true" />
                      </a>
                    )}
                    {project.access.canEdit && (
                      <>
                        <button
                          className="ops-secondary icon-only-button"
                          type="button"
                          disabled={busy === `digest:${artifact.id}`}
                          onClick={() => void redigestArtifact(artifact)}
                          aria-label={`Regenerate digest for ${artifact.title}`}
                          title="Regenerate digest"
                        >
                          <RefreshCw aria-hidden="true" className={busy === `digest:${artifact.id}` ? 'spin' : undefined} />
                        </button>
                        <button
                          className="ops-secondary icon-only-button danger-action"
                          type="button"
                          disabled={busy === `remove:${artifact.id}`}
                          onClick={() => setArtifactToRemove(artifact)}
                          aria-label={`Remove ${artifact.title}`}
                          title="Remove artifact"
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="ops-muted-line">No current artifacts yet</div>
            )}
            {oldArtifacts.length > 0 && <div className="ops-muted-line">{oldArtifacts.length} previous versions retained</div>}
          </div>
        </section>
          </div>
        )}

        {mode === 'progress' && (
          <div className={[
            'project-modal-two-column project-progress-layout',
            project.access.canAddUpdate ? '' : 'timeline-only',
          ].filter(Boolean).join(' ')}>
        <section className="project-timeline-panel">
          <div className="ops-panel-head">
            <div>
              <h2>Timeline</h2>
              <p>Progress updates, notes, decisions, blockers, and artifact summaries.</p>
            </div>
            <History aria-hidden="true" />
          </div>
          <div className="project-timeline">
            {project.updates.length ? (
              project.updates.map((update) => (
                <article className="timeline-item" key={update.id}>
                  <div className="timeline-marker" aria-hidden="true" />
                  <div className="timeline-body">
                    <div className="timeline-head">
                      <strong>{projectUpdateTypeLabels[update.type]}</strong>
                      <span>{formatDate(update.date)} / {update.byUsername}</span>
                    </div>
                    <div className="ops-muted-line">
                      {update.stage ? `Stage ${update.stage}${update.stageProgress !== null ? ` / ${update.stageProgress}%` : ''}` : 'Stage not recorded'}
                      {update.status ? ` / ${statusLabels[update.status]}` : ''}
                      {update.milestone ? ' / milestone' : ''}
                    </div>
                    <p>{update.text}</p>
                    {(update.target || update.blocker) && (
                      <p className="project-blocker">
                        {[update.target ? `Target: ${update.target}` : null, update.blocker ? `Blocker: ${update.blocker}` : null]
                          .filter(Boolean)
                          .join(' / ')}
                      </p>
                    )}
                    {update.comments.map((comment) => (
                      <div className="timeline-comment" key={comment.id}>
                        <strong>{comment.byUsername}</strong>
                        <span>{comment.text}</span>
                      </div>
                    ))}
                    {canComment && (
                      <div className="timeline-comment-form">
                        <input
                          value={commentDrafts[update.id] || ''}
                          onChange={(event) => setCommentDrafts((current) => ({ ...current, [update.id]: event.target.value }))}
                          placeholder="Add comment"
                        />
                        <button
                          className="ops-secondary"
                          type="button"
                          disabled={busy === update.id}
                          onClick={() => void submitComment(update.id)}
                        >
                          <Send aria-hidden="true" />
                          Comment
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))
            ) : (
              <div className="ops-muted-line">No timeline updates yet</div>
            )}
          </div>
        </section>

        {project.access.canAddUpdate && (
          <form className="project-update-form" onSubmit={submitUpdate}>
            <h3>Progress update</h3>
            <label>
              <span>Type</span>
              <select value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as ProjectUpdateType }))}>
                {(Object.keys(projectUpdateTypeLabels) as ProjectUpdateType[]).map((type) => (
                  <option key={type} value={type}>
                    {projectUpdateTypeLabels[type]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Date</span>
              <input type="date" value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} />
            </label>
            <label>
              <span>Stage</span>
              <select value={draft.stage} onChange={(event) => setDraft((current) => ({ ...current, stage: event.target.value }))}>
                {[1, 2, 3, 4, 5].map((stage) => (
                  <option key={stage} value={stage}>
                    {stageLabels[stage]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Stage progress</span>
              <input
                type="number"
                min="0"
                max="100"
                value={draft.stageProgress}
                onChange={(event) => setDraft((current) => ({ ...current, stageProgress: event.target.value }))}
              />
            </label>
            <label>
              <span>Status</span>
              <select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as ProjectStatus }))}>
                {(Object.keys(statusLabels) as ProjectStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status]}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.milestone}
                onChange={(event) => setDraft((current) => ({ ...current, milestone: event.target.checked }))}
              />
              <span>Milestone reached</span>
            </label>
            <label className="full">
              <span>Target</span>
              <textarea rows={2} value={draft.target} onChange={(event) => setDraft((current) => ({ ...current, target: event.target.value }))} />
            </label>
            <label className="full">
              <span>Blocker</span>
              <textarea rows={2} value={draft.blocker} onChange={(event) => setDraft((current) => ({ ...current, blocker: event.target.value }))} />
            </label>
            <label className="full">
              <span>Progress text ({countWords(draft.text)}/50 words)</span>
              <textarea rows={4} value={draft.text} onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))} />
            </label>
            <div className="full artifact-upload-field">
              <span>New artifact</span>
              <span className="artifact-upload-row">
                <input
                  id={`artifact-upload-${project.id}`}
                  type="file"
                  accept=".docx,.pptx,.pdf,.zip,.md,.markdown,.txt,.tex,.latex,.rst,.csv,.json,.yaml,.yml"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] || null;
                    if (file && file.size > projectArtifactMaxBytes) {
                      event.currentTarget.value = '';
                      setError('Artifact file is too large. Limit is 20 MB.');
                      setDraft((current) => ({ ...current, artifactFile: null, artifactFileName: '' }));
                      return;
                    }
                    setError(null);
                    setDraft((current) => ({ ...current, artifactFile: file, artifactFileName: file?.name || '' }));
                  }}
                />
                <label className="ops-secondary" htmlFor={`artifact-upload-${project.id}`} title="Upload artifact">
                  <Upload aria-hidden="true" />
                </label>
                <strong>{draft.artifactFileName || 'No file selected'}</strong>
                {draft.artifactFileName && <small>{titleCase(inferArtifactKind(draft.artifactFileName))}</small>}
              </span>
            </div>
            {uploadProgress !== null && (
              <div className="upload-progress full">
                <span style={{ width: `${uploadProgress}%` }} />
                <strong>{uploadProgress < 100 ? `Uploading ${uploadProgress}%` : 'Upload complete. Digesting...'}</strong>
              </div>
            )}
            {error && <div className="form-message error full">{error}</div>}
            <button className="ops-primary" type="submit" disabled={busy === 'update'}>
              <Plus aria-hidden="true" />
              {busy === 'update' ? 'Adding' : 'Add update'}
            </button>
          </form>
        )}
          </div>
        )}
      </div>
      <ConfirmDialog
        id="remove-artifact-confirm"
        open={Boolean(artifactToRemove)}
        title="Remove artifact?"
        message={artifactToRemove ? `Remove ${artifactToRemove.title} from the current project record?` : ''}
        confirmLabel="Remove"
        busy={Boolean(artifactToRemove && busy === `remove:${artifactToRemove.id}`)}
        onCancel={() => setArtifactToRemove(null)}
        onConfirm={() => {
          if (artifactToRemove) void removeArtifact(artifactToRemove);
        }}
      />
    </div>
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
  const [updateType, setUpdateType] = useState<ThemeUpdateType>('nothing_to_report');
  const [progressText, setProgressText] = useState('');
  const [questions, setQuestions] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [memberCandidateByTheme, setMemberCandidateByTheme] = useState<Record<string, string>>({});

  const plan = payload?.plan;
  const overviewPlan = payload?.overviewPlan;
  const pastPlans = payload?.pastPlans || [];
  const userDirectory = payload?.users || [];
  const updatePlan = payload?.submissionPlan || null;
  const managedThemeIds = useMemo(() => new Set(payload?.access?.canManageThemeIds || []), [payload?.access?.canManageThemeIds]);
  const weekMeetings = useMemo(() => {
    if (overviewPlan) {
      return overviewPlan.meetings;
    }

    return (plan?.meetings || []).map((meeting) => ({
      theme_id: meeting.theme_id,
      title: meeting.title,
      time: meeting.time,
      duration_minutes: meeting.duration_minutes,
      coordinator: meeting.coordinator,
      member_count: meeting.members.length,
      submitted_count: meeting.submitted_members.length,
      planned_minutes: meeting.planned_minutes,
      agenda_count: meeting.agenda_items.length,
      overbooked: meeting.overbooked,
    }));
  }, [overviewPlan, plan]);
  const personalUpdateMeetings = useMemo(() => {
    if (!updatePlan) {
      return [];
    }

    return updatePlan.meetings.filter((meeting) =>
      meeting.members.some((displayName, index) => {
        const username = meeting.member_usernames[index] || '';
        return normalizedName(username) === normalizedName(viewer.username) || isViewerName(displayName, viewer);
      }),
    );
  }, [updatePlan, viewer]);
  const selectedMeeting = personalUpdateMeetings.find((meeting) => meeting.theme_id === themeId) || personalUpdateMeetings[0];
  const selectedThemeId = selectedMeeting?.theme_id || '';
  const submitMembers = useMemo(() => {
    if (!selectedMeeting) {
      return [];
    }

    return selectedMeeting.members
      .map((displayName, index) => ({
        displayName,
        username: selectedMeeting.member_usernames[index] || displayName,
      }))
      .filter(
        (nextMember) => normalizedName(nextMember.username) === normalizedName(viewer.username) || isViewerName(nextMember.displayName, viewer),
      );
  }, [selectedMeeting, viewer]);
  const showPersonalUpdateForm = submitMembers.length > 0;
  const planLabel = overviewPlan || plan || updatePlan;

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
        meetingDate: updatePlan?.meeting_date,
        themeId: selectedThemeId,
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
      new Notification('Theme update saved', { body: `${member} / Theme ${selectedThemeId}` });
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
            {planLabel
              ? `${planLabel.meeting_date} / ${planLabel.cycle_group} / ${planLabel.timezone}`
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

      {formError && <div className="theme-meeting-message form-message error">{formError}</div>}
      {status && <div className="theme-meeting-message form-message">{status}</div>}

      {!plan && !overviewPlan ? (
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
      ) : !weekMeetings.length ? (
        <div className="ops-empty">No theme meetings are scheduled for this week</div>
      ) : (
        <div className="theme-meeting-content">
          <div className={`theme-meeting-grid${showPersonalUpdateForm ? '' : ' planning-only'}`}>
            <div className="theme-meeting-list">
              {weekMeetings.map((summary) => {
                const meeting = plan?.meetings.find((candidate) => candidate.theme_id === summary.theme_id);
                return (
                  <article className="theme-meeting-card" key={summary.theme_id}>
                    <div className="theme-meeting-card-head">
                      <div>
                        <span className="track-chip">Theme {summary.theme_id}</span>
                        <h3>{summary.title}</h3>
                      </div>
                      <strong>{summary.time}</strong>
                    </div>
                    <div className="theme-stats">
                      <span>{summary.duration_minutes} min</span>
                      <span>{summary.submitted_count}/{summary.member_count} submitted</span>
                      <span>{summary.planned_minutes}/{summary.duration_minutes} planned</span>
                    </div>
                    <p className="theme-coordinator">Coordinator: {summary.coordinator}</p>
                    <div className="agenda-mini">
                      {meeting?.agenda_items.length ? (
                        meeting.agenda_items.map((item) => (
                          <div key={`${item.member}-${item.submitted_at}`}>
                            <strong>{item.member}</strong>
                            <span>
                              {updateTypeLabels[item.update_type]} / {item.duration_minutes} min
                            </span>
                          </div>
                        ))
                      ) : summary.agenda_count ? (
                        <div className="ops-muted-line">{summary.agenda_count} planned updates</div>
                      ) : (
                        <div className="ops-muted-line">No planned updates yet</div>
                      )}
                    </div>
                    {meeting && <p className="theme-missing">Missing: {meeting.missing_members.join(', ') || 'none'}</p>}
                    {meeting && managedThemeIds.has(meeting.theme_id) && (
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
                );
              })}
            </div>

            {showPersonalUpdateForm && (
              <form className="theme-update-form" onSubmit={submitUpdate}>
                <h3>Suggest theme slot</h3>
                {updatePlan && <p>For {updatePlan.meeting_date}</p>}
                <label>
                  <span>Theme</span>
                  <select value={themeId} onChange={(event) => setThemeId(event.target.value)}>
                    {personalUpdateMeetings.map((meeting) => (
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
                  <span>Slot type</span>
                  <select value={updateType} onChange={(event) => setUpdateType(event.target.value as ThemeUpdateType)}>
                    {(Object.keys(updateTypeLabels) as ThemeUpdateType[]).map((nextType) => (
                      <option key={nextType} value={nextType}>
                        {updateTypeOptionLabels[nextType]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Progress</span>
                  <textarea
                    value={progressText}
                    onChange={(event) => setProgressText(event.target.value)}
                    placeholder="Project progress summary, up to 50 words"
                    rows={4}
                  />
                </label>
                <label>
                  <span>Questions</span>
                  <textarea
                    value={questions}
                    onChange={(event) => setQuestions(event.target.value)}
                    placeholder="Optional context or question for the slot"
                    rows={3}
                  />
                </label>
                <button className="ops-primary" type="submit">
                  <Check aria-hidden="true" />
                  Save slot
                </button>
              </form>
            )}
          </div>

          {pastPlans.length > 0 && (
            <section className="past-meetings-panel">
              <div className="past-meetings-head">
                <h3>Past meetings</h3>
                <span>{pastPlans.length} recent</span>
              </div>
              <div className="past-meeting-list">
                {pastPlans.map((past) => {
                  const submitted = past.meetings.reduce((total, meeting) => total + meeting.submitted_count, 0);
                  const members = past.meetings.reduce((total, meeting) => total + meeting.member_count, 0);
                  return (
                    <article className="past-meeting-item" key={past.meeting_date}>
                      <div>
                        <strong>{past.meeting_date} / {past.cycle_group}</strong>
                        <span>{submitted}/{members} submitted</span>
                      </div>
                      <p>
                        {past.meetings
                          .map((meeting) => `Theme ${meeting.theme_id}: ${meeting.agenda_count || 0} planned`)
                          .join(' / ')}
                      </p>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </section>
  );
}

function BriefingView({
  projectsPayload,
  projectsLoading,
  themePayload,
  themeMeetingsLoading,
  chatNotifications,
  viewer,
  onOpenProjects,
  onOpenMeeting,
  onOpenAlerts,
}: {
  projectsPayload: ProjectsPayload | null;
  projectsLoading: boolean;
  themePayload: ThemeMeetingPayload | null;
  themeMeetingsLoading: boolean;
  chatNotifications: ChatNotification[];
  viewer: CurrentUser;
  onOpenProjects: () => void;
  onOpenMeeting: () => void;
  onOpenAlerts: () => void;
}) {
  const projects = projectsPayload?.projects || [];
  const activeProjects = projects.filter((project) => project.lifecycle !== 'archived');
  const attentionProjects = activeProjects.filter(projectNeedsAttention);
  const recentProjects = activeProjects.filter((project) => {
    const age = daysSinceDate(project.lastUpdate);
    return age !== null && age <= 14;
  });
  const currentArtifacts = activeProjects.reduce((count, project) => count + currentProjectArtifacts(project).length, 0);
  const unreadChatNotifications = chatNotifications.filter((notification) => !notification.readAt);
  const themeNotifications = themePayload?.notifications || [];
  const meetings = themePayload?.overviewPlan?.meetings || (themePayload?.plan.meetings || []).map((meeting) => ({
    theme_id: meeting.theme_id,
    title: meeting.title,
    time: meeting.time,
    member_count: meeting.members.length,
    submitted_count: meeting.submitted_members.length,
    planned_minutes: meeting.planned_minutes,
    agenda_count: meeting.agenda_items.length,
    overbooked: meeting.overbooked,
  }));
  const ledgerProjects = (attentionProjects.length ? attentionProjects : activeProjects).slice(0, 4);
  const focusLine = projectsPayload
    ? attentionProjects.length
      ? `${attentionProjects.length} project${attentionProjects.length === 1 ? '' : 's'} need attention before the next meeting.`
      : 'No project attention items are open right now.'
    : projectsLoading
      ? 'Loading project state for the current briefing.'
      : 'Project state is not available yet.';

  return (
    <ConsolePageFrame
      title="Briefing"
      subtitle="Everything in one place."
      className="briefing-page"
      wide
    >
      <div className="briefing-content">
        <section className="briefing-hero">
          <picture className="briefing-hero-media" aria-hidden="true">
            <source srcSet="/art/vioscope-briefing-illustration.webp" type="image/webp" />
            <img src="/art/vioscope-briefing-illustration.png" alt="" />
          </picture>
          <div className="briefing-hero-copy">
            <span>Morning table</span>
            <h1>Projects, meetings, and evidence in one calm place.</h1>
            <p>
              {focusLine}
              {' '}
              {themeNotifications.length ? `${themeNotifications.length} meeting alert${themeNotifications.length === 1 ? '' : 's'} are active.` : 'Meeting alerts are quiet.'}
            </p>
            <div className="button-row">
              <button className="ops-primary" type="button" onClick={onOpenProjects}>
                <FileText aria-hidden="true" />
                Review projects
              </button>
              <button className="ops-secondary" type="button" onClick={onOpenMeeting}>
                <CalendarDays aria-hidden="true" />
                Open agenda
              </button>
            </div>
          </div>
        </section>

        <section className="briefing-metrics" aria-label="Briefing summary">
          <div>
            <strong>{activeProjects.length}</strong>
            <span>Active projects</span>
          </div>
          <div>
            <strong>{attentionProjects.length}</strong>
            <span>Need attention</span>
          </div>
          <div>
            <strong>{recentProjects.length}</strong>
            <span>Updated in cycle</span>
          </div>
          <div>
            <strong>{unreadChatNotifications.length + themeNotifications.length}</strong>
            <span>Unread alerts</span>
          </div>
        </section>

        <div className="briefing-grid">
          <section className="ops-panel briefing-ledger">
            <div className="ops-panel-head">
              <div>
                <h2>Project ledger</h2>
                <p>Items most likely to need a coordinator or PI decision.</p>
              </div>
              <button className="ops-secondary" type="button" onClick={onOpenProjects}>
                Open projects
              </button>
            </div>
            {!projectsPayload ? (
              <div className="ops-empty briefing-empty">
                {projectsLoading ? (
                  <>
                    <DotMatrixIcon variant="loading" size={24} />
                    Loading projects
                  </>
                ) : (
                  'Project state is unavailable.'
                )}
              </div>
            ) : ledgerProjects.length ? (
              <div className="briefing-table">
                <div className="briefing-table-head">
                  <span>Project</span>
                  <span>Owner</span>
                  <span>Stage</span>
                  <span>Status</span>
                  <span>Slot</span>
                </div>
                {ledgerProjects.map((project) => (
                  <div className="briefing-row" key={project.id}>
                    <strong>{project.title}</strong>
                    <span>@{project.ownerUsername}</span>
                    <span>{project.stage}/5</span>
                    <StatusChip status={project.status} />
                    <span>{projectSlotLabels[project.recommendation]}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ops-muted-line">No visible projects yet.</div>
            )}
          </section>

          <section className="ops-panel">
            <div className="ops-panel-head">
              <div>
                <h2>Theme meeting</h2>
                <p>{themePayload?.overviewPlan?.meeting_date || themePayload?.plan.meeting_date || 'Current cycle'}</p>
              </div>
              <CalendarDays aria-hidden="true" />
            </div>
            {themeMeetingsLoading && !themePayload ? (
              <div className="ops-empty briefing-empty">
                <DotMatrixIcon variant="loading" size={24} />
                Loading meeting plan
              </div>
            ) : meetings.length ? (
              <ol className="briefing-agenda">
                {meetings.slice(0, 4).map((meeting) => (
                  <li key={meeting.theme_id}>
                    <time>{meeting.time}</time>
                    <div>
                      <strong>{meeting.title}</strong>
                      <span>
                        {meeting.submitted_count}/{meeting.member_count} submitted · {meeting.agenda_count} agenda items
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="ops-muted-line">No meeting plan loaded.</div>
            )}
          </section>

          <section className="ops-panel">
            <div className="ops-panel-head">
              <div>
                <h2>Evidence</h2>
                <p>Current project materials available to cite or review.</p>
              </div>
              <FileText aria-hidden="true" />
            </div>
            <div className="briefing-evidence">
              <strong>{currentArtifacts} current artifacts</strong>
              <p>{recentProjects.length} project updates landed in the current two-week cycle.</p>
              <button className="ops-secondary" type="button" onClick={onOpenProjects}>
                Open project materials
              </button>
            </div>
          </section>

          <section className="ops-panel">
            <div className="ops-panel-head">
              <div>
                <h2>Alerts</h2>
                <p>Mentions, reminders, and operational attention items.</p>
              </div>
              <Bell aria-hidden="true" />
            </div>
            <ul className="briefing-alerts">
              {unreadChatNotifications.slice(0, 2).map((notification) => (
                <li key={notification.id}>{notification.title}</li>
              ))}
              {themeNotifications.slice(0, 2).map((notification) => (
                <li key={notification.id}>{notification.title}</li>
              ))}
              {!unreadChatNotifications.length && !themeNotifications.length && <li>No unread alerts right now.</li>}
            </ul>
            <div className="briefing-panel-action">
              <button className="ops-secondary" type="button" onClick={onOpenAlerts}>
                View alerts
              </button>
            </div>
          </section>
        </div>
      </div>
    </ConsolePageFrame>
  );
}

function ProjectsView({
  projectsPayload,
  projectsLoading,
  viewer,
  collaboratorUsers,
  onProjectsChanged,
}: {
  projectsPayload: ProjectsPayload | null;
  projectsLoading: boolean;
  viewer: CurrentUser;
  collaboratorUsers: MentionableUser[];
  onProjectsChanged: () => Promise<void>;
}) {
  const canSeeAll = canSeeAllRole(viewer.role);
  const mode: ProjectsMode = canSeeAll ? 'pi' : 'member';
  const [confirmed, setConfirmed] = useState(false);
  const [agendaState, setAgendaState] = useState<Record<string, 'added' | 'dismissed'>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [detailProject, setDetailProject] = useState<ManagedProject | null>(null);
  const [detailMode, setDetailMode] = useState<'details' | 'progress'>('details');
  const [actionError, setActionError] = useState<string | null>(null);
  const [planningReport, setPlanningReport] = useState<ProjectPlanningReport | null>(null);
  const [planningBusy, setPlanningBusy] = useState(false);
  const [projectToArchive, setProjectToArchive] = useState<ManagedProject | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const projects = projectsPayload?.projects || [];
  const activeProjects = projects.filter((project) => project.lifecycle !== 'archived');
  const archivedProjects = projects.filter((project) => project.lifecycle === 'archived');
  const attentionProjects = activeProjects.filter(projectNeedsAttention);
  const agendaCandidates = attentionProjects.filter((project) => agendaState[project.id] !== 'dismissed');
  const memberArtifacts = activeProjects.flatMap((project) =>
    currentProjectArtifacts(project).map((artifact) => ({ project, artifact })),
  );

  function openCreateProject() {
    setEditorOpen(true);
  }

  function openProject(project: ManagedProject, mode: 'details' | 'progress') {
    setDetailMode(mode);
    setDetailProject(project);
  }

  async function handleProjectSaved(project: ManagedProject) {
    setEditorOpen(false);
    setDetailProject((current) => (current?.id === project.id ? project : current));
    await onProjectsChanged();
  }

  async function handleProjectChanged(project: ManagedProject) {
    setDetailProject(project);
    await onProjectsChanged();
  }

  async function archiveProject(project: ManagedProject) {
    setProjectToArchive(project);
  }

  async function confirmArchiveProject(project: ManagedProject) {
    setArchiveBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      const body = (await response.json()) as ProjectsPayload;
      if (!response.ok || !body.project) {
        throw new Error(body.error || 'Could not archive project.');
      }
      setProjectToArchive(null);
      setDetailProject((current) => (current?.id === project.id ? null : current));
      await onProjectsChanged();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Could not archive project.');
    } finally {
      setArchiveBusy(false);
    }
  }

  async function unarchiveProject(project: ManagedProject) {
    setActionError(null);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lifecycle: 'active' }),
      });
      const body = (await response.json()) as ProjectsPayload;
      if (!response.ok || !body.project) {
        throw new Error(body.error || 'Could not unarchive project.');
      }
      setDetailProject(body.project);
      await onProjectsChanged();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Could not unarchive project.');
    }
  }

  async function runProjectPlanningScan() {
    setPlanningBusy(true);
    setActionError(null);
    try {
      const response = await fetch('/api/projects/planning', { method: 'POST' });
      const body = (await response.json()) as ProjectPlanningPayload;
      if (!response.ok || !body.report) {
        throw new Error(body.error || 'Could not run project planning scan.');
      }
      setPlanningReport(body.report);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Could not run project planning scan.');
    } finally {
      setPlanningBusy(false);
    }
  }

  return (
    <ConsolePageFrame
      title="Projects"
      actions={
        <button className="ops-primary" type="button" onClick={openCreateProject}>
          <Plus aria-hidden="true" />
          Add project
        </button>
      }
    >
      <div className="dashboard-content">
      {actionError && (
        <div className="ops-notice error">
          <AlertCircle aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      )}
      {!projectsPayload ? (
        <div className="ops-empty">
          {projectsLoading ? (
            <>
              <DotMatrixIcon variant="loading" size={24} />
              Loading projects
            </>
          ) : (
            'Could not load projects. Check the error above, then refresh.'
          )}
        </div>
      ) : mode === 'member' ? (
        <div className="dashboard-stack">
          <div className="summary-strip">
            <span>{viewer.displayName || viewer.username}</span>
            <strong>{activeProjects.length} visible projects</strong>
            <strong>{attentionProjects.length} need attention</strong>
            <strong>{archivedProjects.length} archived</strong>
          </div>

          <div className="project-grid">
            {activeProjects.length ? (
              activeProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onOpenDetails={(nextProject) => openProject(nextProject, 'details')}
                  onOpenProgress={(nextProject) => openProject(nextProject, 'progress')}
                />
              ))
            ) : (
              <div className="ops-empty">No visible projects yet. Add one to start tracking work.</div>
            )}
          </div>

          <div className="dashboard-split">
            <section className="ops-panel">
              <div className="ops-panel-head">
                <div>
                  <h2>This week's theme meeting</h2>
                  <p>Agenda assembled from current project state.</p>
                </div>
                <StatusChip status={attentionProjects[0]?.status || 'on_track'} />
              </div>
              <ol className="agenda-list">
                <li>Round-table status check</li>
                {attentionProjects.slice(0, 2).map((project) => (
                  <li key={project.id}>{projectSlotLabels[project.recommendation]}: {project.title}</li>
                ))}
                <li>Submission and materials follow-ups</li>
              </ol>
              <div className="confirm-box">
                <strong>Confirm your status for the round-table</strong>
                <p>
                  {activeProjects[0]
                    ? `${activeProjects[0].title} is ${statusLabels[activeProjects[0].status].toLowerCase()}; last update was ${formatAge(
                        daysSinceDate(activeProjects[0].lastUpdate),
                      )} ago.`
                    : 'No member project is available.'}
                </p>
                <div className="button-row">
                  <button className="ops-primary" type="button" onClick={() => setConfirmed(true)}>
                    <Check aria-hidden="true" />
                    {confirmed ? 'Confirmed' : 'Confirm'}
                  </button>
                  <button className="ops-secondary" type="button">
                    Review timeline
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
                    <a href={`/api/project-artifacts/${item.artifact.id}/download`} key={item.artifact.id}>
                      <span>{item.artifact.title}</span>
                      <small>{item.project.title}</small>
                    </a>
                  ))
                ) : (
                  <div className="ops-muted-line">No artifacts linked yet</div>
                )}
              </div>
            </section>
          </div>
          {archivedProjects.length > 0 && (
            <section className="ops-panel">
              <div className="ops-panel-head">
                <div>
                  <h2>Archived projects</h2>
                  <p>Retained for lookup, hidden from active planning.</p>
                </div>
                <History aria-hidden="true" />
              </div>
              <div className="attention-grid">
                {archivedProjects.map((project) => (
                  <article className="attention-card archived-project-card" key={project.id}>
                    <div>
                      <h3>{project.title}</h3>
                      <p>{project.ownerUsername} / archived {project.archivedAt ? formatDate(project.archivedAt.slice(0, 10)) : ''}</p>
                    </div>
                    <div className="button-row compact">
                      <button className="ops-secondary icon-only-button" type="button" onClick={() => openProject(project, 'details')} aria-label={`View ${project.title}`} title="Details">
                        <FileText aria-hidden="true" />
                      </button>
                      {project.access.canArchive && (
                        <button className="ops-secondary icon-only-button" type="button" onClick={() => void unarchiveProject(project)} aria-label={`Unarchive ${project.title}`} title="Unarchive">
                          <RotateCcw aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="dashboard-stack">
          <div className="summary-strip">
            <span>Projects</span>
            <strong>{activeProjects.length} active projects</strong>
            <strong>{attentionProjects.length} need attention</strong>
            <strong>{archivedProjects.length} archived</strong>
          </div>

          <section className="ops-panel project-planning-panel">
            <div className="ops-panel-head">
              <div>
                <h2>Project planning brief</h2>
                <p>Attention items first, then projects updated in the current two-week cycle.</p>
              </div>
              <button className="ops-primary" type="button" disabled={planningBusy} onClick={() => void runProjectPlanningScan()}>
                <RefreshCw aria-hidden="true" className={planningBusy ? 'spin' : undefined} />
                {planningBusy ? 'Scanning' : 'Run project scan'}
              </button>
            </div>
            {planningReport ? (
              <div className="planning-brief-grid">
                <div className="summary-strip compact">
                  <strong>{planningReport.attentionItems.length} attention</strong>
                  <strong>{planningReport.updatedProjects.length} updated</strong>
                  <strong>Since {planningReport.cycleStart}</strong>
                </div>
                <div className="planning-brief-columns">
                  <div>
                    <h3>Attention</h3>
                    {planningReport.attentionItems.length ? (
                      planningReport.attentionItems.slice(0, 5).map((item) => {
                        const project = projects.find((candidate) => candidate.id === item.id);
                        return (
                          <button
                            className="planning-brief-item"
                            disabled={!project}
                            key={item.id}
                            type="button"
                            onClick={() => project && openProject(project, 'progress')}
                          >
                            <strong>{projectPlanningLine(item)}</strong>
                            <span>{item.attentionReason || item.blocker || 'Needs review'}</span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="ops-muted-line">No attention items</div>
                    )}
                  </div>
                  <div>
                    <h3>Updated</h3>
                    {planningReport.updatedProjects.length ? (
                      planningReport.updatedProjects.slice(0, 5).map((item) => {
                        const project = projects.find((candidate) => candidate.id === item.id);
                        return (
                          <button
                            className="planning-brief-item"
                            disabled={!project}
                            key={item.id}
                            type="button"
                            onClick={() => project && openProject(project, 'progress')}
                          >
                            <strong>{projectPlanningLine(item)}</strong>
                            <span>{item.progressText || 'Progress recorded'}</span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="ops-muted-line">No project progress updates in this cycle</div>
                    )}
                  </div>
                </div>
                <pre className="project-brief-preview">{planningReport.markdown}</pre>
              </div>
            ) : (
              <div className="ops-muted-line">Run a scan to build the current project brief.</div>
            )}
          </section>

          <section className="ops-panel">
            <div className="ops-panel-head">
              <div>
                <h2>Needs attention</h2>
                <p>Advisory suggestions. The organizer decides what goes on the agenda.</p>
              </div>
              <ShieldCheck aria-hidden="true" />
            </div>
            <div className="attention-grid">
              {agendaCandidates.length ? (
                agendaCandidates.map((project) => (
                  <article className="attention-card" key={project.id}>
                    <div>
                      <h3>{project.title}</h3>
                      <p>
                        {project.ownerUsername} / stage {project.stage} ({project.stageProgress}%) / last update {formatAge(daysSinceDate(project.lastUpdate))} ago
                      </p>
                    </div>
                    <StatusChip status={project.status} />
                    <p>
                      <strong>Evidence:</strong> {projectEvidence(project)}
                    </p>
                    <p>
                      <strong>Suggested slot:</strong> {projectSlotLabels[project.recommendation]}
                    </p>
                    <div className="button-row">
                      <button
                        className="ops-primary"
                        type="button"
                        onClick={() => setAgendaState((current) => ({ ...current, [project.id]: 'added' }))}
                      >
                        {agendaState[project.id] === 'added' ? 'Added' : 'Add to agenda'}
                      </button>
                      <button
                        className="ops-secondary"
                        type="button"
                        onClick={() => setAgendaState((current) => ({ ...current, [project.id]: 'dismissed' }))}
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
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id} className={project.lifecycle === 'archived' ? 'archived-project-row' : undefined}>
                      <td>{project.ownerUsername}</td>
                      <td>{project.title}</td>
                      <td>{project.track}</td>
                      <td>
                        <div className="table-stage">
                          <StageBar stage={project.stage} />
                          <span>{project.stage}/5 · {project.stageProgress}%</span>
                        </div>
                      </td>
                      <td>
                        <StatusChip status={project.status} />
                      </td>
                      <td>{project.target || 'Not set'}</td>
                      <td>{currentProjectArtifacts(project).length}</td>
                      <td>
                        <div className="button-row compact">
                          <button
                            className="ops-secondary icon-only-button"
                            type="button"
                            onClick={() => openProject(project, 'details')}
                            aria-label={`Project details for ${project.title}`}
                            title="Project details"
                          >
                            <FileText aria-hidden="true" />
                          </button>
                          {project.access.canAddUpdate && project.lifecycle !== 'archived' && (
                            <button
                              className="ops-primary icon-only-button"
                              type="button"
                              onClick={() => openProject(project, 'progress')}
                              aria-label={`Progress update for ${project.title}`}
                              title="Progress update"
                            >
                              <Plus aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
      {editorOpen && (
        <ProjectEditorModal
          project={null}
          viewer={viewer}
          collaboratorUsers={collaboratorUsers}
          existingProjects={projects}
          onClose={() => {
            setEditorOpen(false);
          }}
          onSaved={handleProjectSaved}
        />
      )}
      {detailProject && (
        <ProjectDetailModal
          project={detailProject}
          viewer={viewer}
          collaboratorUsers={collaboratorUsers}
          existingProjects={projects}
          initialMode={detailMode}
          onClose={() => setDetailProject(null)}
          onSaved={handleProjectChanged}
          onChanged={handleProjectChanged}
          onArchive={archiveProject}
          onUnarchive={unarchiveProject}
        />
      )}
      <ConfirmDialog
        id="archive-project-confirm"
        open={Boolean(projectToArchive)}
        title="Archive project?"
        message={projectToArchive ? `Archive ${projectToArchive.title}? It will be hidden from active planning but kept for lookup.` : ''}
        confirmLabel="Archive"
        busy={archiveBusy}
        onCancel={() => setProjectToArchive(null)}
        onConfirm={() => {
          if (projectToArchive) void confirmArchiveProject(projectToArchive);
        }}
      />
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
      subtitle="Briefing / Theme meeting"
      className="meeting-page"
      wide
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const draftBeforeHistoryRef = useRef('');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState(() => `web-${Date.now()}`);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [historyMode, setHistoryMode] = useState<ChatHistoryMode>('owned');
  const [mentionUsers, setMentionUsers] = useState<MentionableUser[]>([]);
  const [draftHistoryCursor, setDraftHistoryCursor] = useState<number | null>(null);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<ChatSession | null>(null);

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
    setDraftHistoryCursor(null);
    setSendStatus(null);
  }

  function restoreChat(session: ChatSession) {
    setThreadId(session.threadId);
    setMessages(session.messages);
    setDraft('');
    setDraftHistoryCursor(null);
    setSendStatus(null);
  }

  function usePrompt(prompt: string) {
    setDraft(prompt);
    setDraftHistoryCursor(null);
    setSendStatus(null);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function deleteSession(session: ChatSession) {
    try {
      const response = await fetch('/api/chat/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: session.threadId }),
      });
      const body = (await response.json()) as { result?: 'deleted' | 'removed'; error?: string };
      if (!response.ok) {
        throw new Error(body.error || 'Could not delete chat session.');
      }

      setSessionToDelete(null);
      setSessions((current) => current.filter((candidate) => candidate.threadId !== session.threadId));
      if (threadId === session.threadId) {
        setThreadId(`web-${Date.now()}`);
        setMessages([]);
        setDraft('');
        setDraftHistoryCursor(null);
      }
      setSendStatus(body.result === 'removed' ? 'Removed shared chat session.' : 'Deleted chat session.');
    } catch (caught) {
      setSendStatus(caught instanceof Error ? caught.message : 'Could not delete chat session.');
    }
  }

  async function renameSession(session: ChatSession) {
    const title = window.prompt('Rename chat session', session.title);
    if (title === null) return;

    try {
      const response = await fetch('/api/chat/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: session.threadId, title }),
      });
      const body = (await response.json()) as { session?: ChatSession; error?: string };
      if (!response.ok || !body.session) {
        throw new Error(body.error || 'Could not rename chat session.');
      }

      setSessions((current) => current.map((candidate) => (candidate.threadId === session.threadId ? body.session! : candidate)));
      setSendStatus('Renamed chat session.');
    } catch (caught) {
      setSendStatus(caught instanceof Error ? caught.message : 'Could not rename chat session.');
    }
  }

  function chooseMention(username: string) {
    setDraft((current) => insertMention(current, username));
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function moveDraftHistory(direction: -1 | 1) {
    const sentMessages = messages.filter((message) => message.role === 'user').map((message) => message.text);
    if (!sentMessages.length) return;
    if (draftHistoryCursor === null && direction === 1) return;

    if (draftHistoryCursor === null) {
      draftBeforeHistoryRef.current = draft;
    }

    const nextCursor = draftHistoryCursor === null ? sentMessages.length - 1 : draftHistoryCursor + direction;
    if (nextCursor >= sentMessages.length) {
      setDraft(draftBeforeHistoryRef.current);
      setDraftHistoryCursor(null);
      return;
    }

    const clampedCursor = Math.max(0, nextCursor);
    setDraft(sentMessages[clampedCursor]);
    setDraftHistoryCursor(clampedCursor);
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Tab' && mentionQuery !== null && mentionOptions.length > 0) {
      event.preventDefault();
      chooseMention(mentionOptions[0].username);
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveDraftHistory(event.key === 'ArrowUp' ? -1 : 1);
    }
  }

  async function send(nextQuestion = draft) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || isSending) return;
    const assistantId = chatMessageId('assistant');
    setDraft('');
    setDraftHistoryCursor(null);
    setSendStatus(null);
    setIsSending(true);
    setMessages((current) => [
      ...current,
      {
        id: chatMessageId('user'),
        role: 'user',
        text: trimmed,
        actorUserId: viewer.id,
        actorUsername: viewer.username,
        actorDisplayName: viewer.displayName,
        actorAvatarUrl: profileAvatarUrl(viewer),
      },
      { id: assistantId, role: 'assistant', text: vioscopeChatUiConfig.thinkingText, status: 'thinking' },
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
      title={vioscopeChatUiConfig.title}
      className="chat-page"
      actions={
        <div className="chat-actions">
          <button className="ops-primary" type="button" onClick={newChat}>
            <Plus aria-hidden="true" />
            New chat
          </button>
        </div>
      }
    >
      <section className="chat-view">
        <aside className="chat-session-column" aria-label="Chat sessions">
          <div className="chat-session-search">
            <Search aria-hidden="true" />
            <span>{visibleSessions.length} {historyMode === 'owned' ? 'history sessions' : 'shared sessions'}</span>
          </div>
          <div className="chat-history-tabs" role="tablist" aria-label="Chat session lists">
            <button
              className={historyMode === 'owned' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={historyMode === 'owned'}
              onClick={() => setHistoryMode('owned')}
            >
              History
            </button>
            <button
              className={historyMode === 'shared' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={historyMode === 'shared'}
              onClick={() => setHistoryMode('shared')}
            >
              Shared
            </button>
          </div>
          {visibleSessions.length ? (
            <div className="chat-history-list">
              {visibleSessions.map((session) => (
                <div className={`chat-history-item${session.threadId === threadId ? ' active' : ''}`} key={session.threadId}>
                  <button className="chat-history-open" type="button" onClick={() => restoreChat(session)}>
                    <span>{session.title}</span>
                    <small>
                      {historyMode === 'shared'
                        ? `Shared by ${session.sharedByDisplayName || session.ownerDisplayName || 'a teammate'} · `
                        : ''}
                      {chatSessionTime(session.updatedAt)}
                    </small>
                  </button>
                  <div className="chat-history-actions">
                    {session.membershipKind !== 'shared' && (
                      <button
                        className="chat-history-rename"
                        type="button"
                        onClick={() => renameSession(session)}
                        aria-label="Rename chat session"
                        title="Rename chat session"
                      >
                        <Pencil aria-hidden="true" />
                      </button>
                    )}
                    <button
                      className="chat-history-delete"
                      type="button"
                      onClick={() => setSessionToDelete(session)}
                      aria-label={session.membershipKind === 'shared' ? 'Remove shared chat session' : 'Delete chat session'}
                      title={session.membershipKind === 'shared' ? 'Remove shared chat session' : 'Delete chat session'}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="chat-history-empty">
              {historyMode === 'shared' ? 'No shared chat sessions yet.' : 'No saved chat sessions yet.'}
            </p>
          )}
        </aside>

        <div className="chat-main">
          <div className="chat-main-head">
            <div>
              <strong>{threadId.startsWith('web-') && messages.length === 0 ? 'New VioScope session' : 'VioScope session'}</strong>
              <span>{messages.length} message{messages.length === 1 ? '' : 's'}</span>
            </div>
            <span className="chat-presence">
              <span aria-hidden="true" />
              Ready
            </span>
          </div>

          <div className="chat-scroll" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="chat-empty">
                <DotMatrixIcon iconIndex={0} size={48} />
                <h2>{vioscopeChatUiConfig.emptyTitle}</h2>
                <div className="prompt-grid">
                  {vioscopeChatUiConfig.starterPrompts.map((prompt) => (
                    <button key={prompt} type="button" onClick={() => usePrompt(prompt)}>
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
                    <div
                      className={`chat-user-turn${message.actorUserId === viewer.id ? ' own' : ''}`}
                      key={message.id}
                    >
                      <ChatActorAvatar message={message} viewer={viewer} />
                      <div className="chat-user-message">
                        <div className="chat-user-meta">{chatActorLabel(message, viewer)}</div>
                        <div className="user-bubble">{message.text}</div>
                      </div>
                    </div>
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
                              {vioscopeChatUiConfig.thinkingText}
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
                  <button
                    className={mentionOptions[0]?.id === user.id ? 'active' : ''}
                    key={user.id}
                    type="button"
                    onClick={() => chooseMention(user.username)}
                  >
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
                ref={inputRef}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setDraftHistoryCursor(null);
                }}
                onKeyDown={handleDraftKeyDown}
                placeholder={vioscopeChatUiConfig.inputPlaceholder}
                disabled={isSending}
              />
              <button aria-label="Send" type="submit" disabled={isSending || !draft.trim()}>
                <Send aria-hidden="true" />
              </button>
            </form>
            {sendStatus && <small className="chat-send-status">{sendStatus}</small>}
          </div>
        </div>
      </section>
      <ConfirmDialog
        id="delete-chat-session-confirm"
        open={Boolean(sessionToDelete)}
        title={sessionToDelete?.membershipKind === 'shared' ? 'Remove shared session?' : 'Delete chat session?'}
        message={
          sessionToDelete?.membershipKind === 'shared'
            ? 'Remove this shared chat session from your history? The owner keeps their copy.'
            : 'Delete this chat session and its saved messages?'
        }
        confirmLabel={sessionToDelete?.membershipKind === 'shared' ? 'Remove' : 'Delete'}
        onCancel={() => setSessionToDelete(null)}
        onConfirm={() => {
          if (sessionToDelete) void deleteSession(sessionToDelete);
        }}
      />
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
                : 'Idea Pitch is available as an advisory checklist view; the automated B2 runner remains backlog.'}
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
  attentionProjects,
  themePayload,
  chatNotifications,
  onMarkChatNotificationRead,
  onMarkAllChatNotificationsRead,
  onOpenChatSession,
}: {
  attentionProjects: ManagedProject[];
  themePayload: ThemeMeetingPayload | null;
  chatNotifications: ChatNotification[];
  onMarkChatNotificationRead: (notificationId: string) => Promise<void>;
  onMarkAllChatNotificationsRead: () => Promise<void>;
  onOpenChatSession: (sessionId: string, notificationId?: string) => void;
}) {
  const [markError, setMarkError] = useState<string | null>(null);
  const [isMarking, setIsMarking] = useState(false);
  const themeNotifications = themePayload?.notifications || [];
  const unreadChatNotifications = chatNotifications.filter((notification) => !notification.readAt);
  const readChatNotifications = chatNotifications.filter((notification) => notification.readAt);
  const activeCount = unreadChatNotifications.length + themeNotifications.length + attentionProjects.length;

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
        {attentionProjects.length ? (
          attentionProjects.map((project) => (
            <article className="alert-item" key={project.id}>
              <Bell aria-hidden="true" />
              <div>
                <strong>{project.title}</strong>
                <p>
                  {projectSlotLabels[project.recommendation]} suggested for {project.ownerUsername}: {projectEvidence(project)}.
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
        {!chatNotifications.length && !themeNotifications.length && !attentionProjects.length ? (
          <div className="ops-empty">No alerts right now</div>
        ) : null}
      </div>
    </ConsolePageFrame>
  );
}

type TopbarNotificationTab = 'messages' | 'events' | 'logs';

function TopbarNotificationCenter({
  open,
  activeCount,
  chatNotifications,
  themeNotifications,
  attentionProjects,
  onToggle,
  onOpenAlerts,
  onOpenChatSession,
  onMarkAllMessagesRead,
}: {
  open: boolean;
  activeCount: number;
  chatNotifications: ChatNotification[];
  themeNotifications: ThemeMeetingNotification[];
  attentionProjects: ManagedProject[];
  onToggle: () => void;
  onOpenAlerts: () => void;
  onOpenChatSession: (sessionId: string, notificationId?: string) => void;
  onMarkAllMessagesRead: () => void;
}) {
  const [tab, setTab] = useState<TopbarNotificationTab>('messages');
  const unreadMessages = chatNotifications.filter((notification) => !notification.readAt);
  const visibleMessages = (unreadMessages.length ? unreadMessages : chatNotifications).slice(0, 6);
  const visibleEvents = themeNotifications.slice(0, 6);
  const visibleLogs = attentionProjects.slice(0, 6);

  return (
    <div className="topbar-notification">
      <button
        className="topbar-notification-button"
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell aria-hidden="true" />
        <span>Notification</span>
        {activeCount > 0 && <strong>{activeCount}</strong>}
      </button>
      {open && (
        <section className="notification-popover" aria-label="Notifications Center">
          <header>
            <strong>Notifications Center</strong>
            <div>
              {unreadMessages.length > 0 && (
                <button type="button" onClick={onMarkAllMessagesRead}>
                  Mark read
                </button>
              )}
              <span>{activeCount}</span>
            </div>
          </header>
          <div className="notification-tabs" role="tablist" aria-label="Notification categories">
            <button
              className={tab === 'messages' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={tab === 'messages'}
              onClick={() => setTab('messages')}
            >
              Message
            </button>
            <button
              className={tab === 'events' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={tab === 'events'}
              onClick={() => setTab('events')}
            >
              Events
            </button>
            <button
              className={tab === 'logs' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={tab === 'logs'}
              onClick={() => setTab('logs')}
            >
              Logs
            </button>
          </div>
          <div className="notification-list">
            {tab === 'messages' &&
              (visibleMessages.length ? (
                visibleMessages.map((notification) => (
                  <button
                    className={`notification-row${notification.readAt ? '' : ' unread'}`}
                    key={notification.id}
                    type="button"
                    onClick={() => onOpenChatSession(notification.sessionId, notification.readAt ? undefined : notification.id)}
                  >
                    <AvatarCircle
                      user={{
                        id: notification.actorUserId,
                        username: notification.actorUsername,
                        displayName: notification.actorDisplayName,
                        email: null,
                        role: 'member',
                        position: null,
                        provisioningStatus: 'active',
                        sourceProfileId: null,
                        aliases: [],
                        notificationPreferences: defaultNotificationPreferences(),
                        passwordResetRequired: false,
                        passwordChangedAt: null,
                        lastLoginAt: null,
                      }}
                    />
                    <span>
                      <strong>{notification.title}</strong>
                      <small>{notification.body}</small>
                    </span>
                    <em>{chatSessionTime(notification.createdAt)}</em>
                  </button>
                ))
              ) : (
                <p className="notification-empty">No chat messages right now.</p>
              ))}
            {tab === 'events' &&
              (visibleEvents.length ? (
                visibleEvents.map((notification) => (
                  <div className="notification-row" key={notification.id}>
                    <span className="notification-glyph">
                      <CalendarDays aria-hidden="true" />
                    </span>
                    <span>
                      <strong>{notification.title}</strong>
                      <small>{notification.body}</small>
                    </span>
                  </div>
                ))
              ) : (
                <p className="notification-empty">No meeting events right now.</p>
              ))}
            {tab === 'logs' &&
              (visibleLogs.length ? (
                visibleLogs.map((project) => (
                  <div className="notification-row" key={project.id}>
                    <span className="notification-glyph">
                      <AlertCircle aria-hidden="true" />
                    </span>
                    <span>
                      <strong>{project.title}</strong>
                      <small>{projectSlotLabels[project.recommendation]} · {project.attentionReason || project.blocker || statusLabels[project.status]}</small>
                    </span>
                    <em>{project.ownerUsername}</em>
                  </div>
                ))
              ) : (
                <p className="notification-empty">No project logs right now.</p>
              ))}
          </div>
          <button className="notification-view-all" type="button" onClick={onOpenAlerts}>
            View all notifications
          </button>
        </section>
      )}
    </div>
  );
}

function draftFromUser(user: ManagedUser): UserDraft {
  const email = profileEmail(user);
  return {
    displayName: user.displayName,
    email: email === '-' ? '' : email,
    avatarUrl: profileAvatarUrl(user),
    role: user.role,
    position: user.position || '',
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
  if (role === 'administrator') return 'Administrator';
  return titleCase(role);
}

function positionLabel(position: UserPosition | null | '') {
  if (!position) return '-';
  if (position === 'pi') return 'PI';
  if (position === 'software_engineer') return 'Software Engineer';
  return titleCase(position);
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
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
  const [activeConfigSection, setActiveConfigSection] = useState<AdminConfigSetting['section']>('model');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settings = payload?.settings || [];
  const configGroups = useMemo(() => groupedConfigSettings(settings), [settings]);
  const activeConfigGroup = configGroups.find((group) => group.section === activeConfigSection) || configGroups[0] || null;
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

  useEffect(() => {
    if (configGroups.length && !configGroups.some((group) => group.section === activeConfigSection)) {
      setActiveConfigSection(configGroups[0].section);
    }
  }, [activeConfigSection, configGroups]);

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
      setRestartConfirmOpen(false);
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
        <p>Runtime settings and service restart controls.</p>
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
                <h2>Runtime settings</h2>
                <p>{changedKeys.length ? `${changedKeys.length} pending change(s)` : 'No pending changes'}</p>
              </div>
              <button className="ops-primary" type="button" onClick={() => void saveConfig()} disabled={busy || !changedKeys.length}>
                <Save aria-hidden="true" />
                {busy ? 'Saving' : 'Save changes'}
              </button>
            </div>
            <div className="config-section-tabs" role="tablist" aria-label="Configuration sections">
              {configGroups.map((group) => (
                <button
                  key={group.section}
                  type="button"
                  role="tab"
                  aria-selected={activeConfigGroup?.section === group.section}
                  className={activeConfigGroup?.section === group.section ? 'active' : ''}
                  onClick={() => setActiveConfigSection(group.section)}
                >
                  <span>{group.label}</span>
                  <strong>{group.settings.length}</strong>
                </button>
              ))}
            </div>
            <div className="config-groups">
              {activeConfigGroup ? (
                <section className="config-group" key={activeConfigGroup.section}>
                  <h3>{activeConfigGroup.label}</h3>
                  {activeConfigGroup.settings.map((setting) => (
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
                        {setting.valueType === 'weekday' ? (
                          <select
                            value={drafts[setting.key] ?? ''}
                            onChange={(event) => setDrafts((current) => ({ ...current, [setting.key]: event.target.value }))}
                          >
                            {configWeekdays.map((weekday) => (
                              <option key={weekday} value={weekday}>
                                {weekday}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={setting.valueType === 'number' || setting.valueType === 'time' ? setting.valueType : 'text'}
                            value={drafts[setting.key] ?? ''}
                            onChange={(event) => setDrafts((current) => ({ ...current, [setting.key]: event.target.value }))}
                            placeholder={setting.optional ? 'optional' : undefined}
                          />
                        )}
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
              ) : (
                <div className="ops-empty">No configuration settings available.</div>
              )}
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
                onClick={() => setRestartConfirmOpen(true)}
              >
                <Power aria-hidden="true" />
                {restartBusy ? 'Requesting' : 'Restart'}
              </button>
            </div>
          </section>
          <ConfirmDialog
            id="restart-service-confirm"
            open={restartConfirmOpen}
            title="Request service restart?"
            message="Request a VioScope service restart now? Runtime changes may briefly interrupt active users."
            confirmLabel="Restart"
            busy={restartBusy}
            onCancel={() => setRestartConfirmOpen(false)}
            onConfirm={() => void requestRestart()}
          />
        </>
      )}
    </section>
  );
}

function ThemeMeetingSettingsPanel() {
  const [payload, setPayload] = useState<ThemeMeetingSettingsPayload | null>(null);
  const [draft, setDraft] = useState<ThemeMeetingConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const users = useMemo(
    () => (payload?.users || []).slice().sort((left, right) => left.displayName.localeCompare(right.displayName)),
    [payload?.users],
  );
  const userByUsername = useMemo(() => new Map(users.map((nextUser) => [nextUser.username, nextUser])), [users]);
  const canEditGlobal = Boolean(payload?.access?.canEditGlobal);
  const editableThemeIds = payload?.access?.editableThemeIds || [];

  const applyPayload = useCallback((nextPayload: ThemeMeetingSettingsPayload) => {
    setPayload(nextPayload);
    setDraft(nextPayload.config ? JSON.parse(JSON.stringify(nextPayload.config)) as ThemeMeetingConfig : null);
  }, []);

  const loadSettings = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch('/api/theme-meetings/config');
      const body = (await response.json()) as ThemeMeetingSettingsPayload;
      if (!response.ok || !body.config) {
        throw new Error(body.error || 'Could not load theme meeting settings.');
      }
      applyPayload(body);
      setLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load theme meeting settings.');
      setLoaded(true);
    }
  }, [applyPayload]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  function updateTheme(themeId: string, patch: Partial<ThemeMeetingConfig['themes'][number]>) {
    setDraft((current) => current ? {
      ...current,
      themes: current.themes.map((theme) => (theme.theme_id === themeId ? { ...theme, ...patch } : theme)),
    } : current);
    setMessage(null);
  }

  function updateSubmission(type: ThemeUpdateType, durationMinutes: string) {
    const duration = Math.max(0, Number.parseInt(durationMinutes || '0', 10) || 0);
    setDraft((current) => current ? {
      ...current,
      submission: {
        ...current.submission,
        update_types: {
          ...current.submission.update_types,
          [type]: {
            ...(current.submission.update_types[type] || { questions_required: false }),
            duration_minutes: duration,
            questions_required: false,
          },
        },
      },
    } : current);
    setMessage(null);
  }

  function updateReminder(name: string, patch: Record<string, string>) {
    setDraft((current) => {
      if (!current) return current;
      const existing = current.reminders.find((reminder) => reminder.name === name) || { name };
      const reminders = current.reminders.filter((reminder) => reminder.name !== name);
      return {
        ...current,
        reminders: [...reminders, { ...existing, ...patch }],
      };
    });
    setMessage(null);
  }

  function reminderValue(name: string, key: 'weekday' | 'time', fallback: string): string {
    const value = draft?.reminders.find((reminder) => reminder.name === name)?.[key];
    return typeof value === 'string' ? value : fallback;
  }

  function memberNames(usernames: string[] = []) {
    return usernames.map((username) => userByUsername.get(username)?.displayName || username).join(', ') || 'No members';
  }

  function addMember(theme: ThemeMeetingConfig['themes'][number], username: string) {
    const normalized = username.trim().toLowerCase();
    if (!normalized) return;
    updateTheme(theme.theme_id, {
      member_users: [...new Set([...(theme.member_users || []), normalized])],
    });
  }

  function removeMember(theme: ThemeMeetingConfig['themes'][number], username: string) {
    updateTheme(theme.theme_id, {
      member_users: (theme.member_users || []).filter((member) => member !== username),
    });
  }

  async function saveSettings() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/theme-meetings/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: draft }),
      });
      const body = (await response.json()) as ThemeMeetingSettingsPayload;
      if (!response.ok || !body.config) {
        throw new Error(body.error || 'Could not save theme meeting settings.');
      }
      applyPayload(body);
      setMessage('Theme meeting settings saved.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save theme meeting settings.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <h2>Theme meeting</h2>
        <p>Manage theme groups, coordinators, slot durations, and reminder timing.</p>
      </div>
      {error && <div className="form-message error">{error}</div>}
      {message && <div className="form-message">{message}</div>}
      {!loaded || !draft ? (
        <div className="members-loading">
          <DotMatrixIcon variant="loading" size={24} />
          <span>Loading theme meeting settings</span>
        </div>
      ) : (
        <div className="theme-settings-shell">
          <section className="ops-panel theme-settings-toolbar">
            <div className="ops-panel-head">
              <div>
                <h2>Meeting configuration</h2>
                <p>{canEditGlobal ? 'PI/admin access' : 'Coordinator access'} · {payload?.paths?.config || 'configured path'}</p>
              </div>
              <div className="button-row">
                <button className="ops-secondary" type="button" disabled={busy || !payload} onClick={() => payload && applyPayload(payload)}>
                  <RotateCcw aria-hidden="true" />
                  Reset
                </button>
                <button className="ops-primary" type="button" disabled={busy} onClick={() => void saveSettings()}>
                  <Save aria-hidden="true" />
                  {busy ? 'Saving' : 'Save changes'}
                </button>
              </div>
            </div>
          </section>

          {canEditGlobal && (
            <div className="theme-settings-config-grid">
              <section className="ops-panel theme-settings-section">
                <div className="theme-settings-section-head">
                  <h3>Schedule</h3>
                </div>
                <div className="theme-settings-row">
                  <div>
                    <strong>Timezone</strong>
                    <p>Theme meetings use UK local time.</p>
                  </div>
                  <div className="theme-settings-control">
                    <input value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} />
                  </div>
                </div>
                <div className="theme-settings-row">
                  <div>
                    <strong>Anchor date</strong>
                    <p>Defines the alternating AB/CD cycle.</p>
                  </div>
                  <div className="theme-settings-control">
                    <input
                      type="date"
                      value={draft.cycle.anchor_date}
                      onChange={(event) => setDraft({ ...draft, cycle: { ...draft.cycle, anchor_date: event.target.value } })}
                    />
                  </div>
                </div>
                {themeMeetingReminderRows.map((row) => (
                  <div className="theme-settings-row" key={row.name}>
                    <div>
                      <strong>{row.label}</strong>
                      <p>{row.name}</p>
                    </div>
                    <div className="theme-settings-control split">
                      <select
                        value={reminderValue(row.name, 'weekday', row.name === 'agenda_cutoff' ? 'Wednesday' : row.name === 'first_reminder' ? 'Monday' : 'Tuesday')}
                        onChange={(event) => updateReminder(row.name, { weekday: event.target.value })}
                      >
                        {configWeekdays.map((weekday) => (
                          <option key={weekday} value={weekday}>
                            {weekday}
                          </option>
                        ))}
                      </select>
                      <input
                        type="time"
                        value={reminderValue(row.name, 'time', row.name === 'agenda_cutoff' ? '08:00' : row.name === 'first_reminder' ? '10:00' : '15:00')}
                        onChange={(event) => updateReminder(row.name, { time: event.target.value })}
                      />
                    </div>
                  </div>
                ))}
              </section>

              <section className="ops-panel theme-settings-section">
                <div className="theme-settings-section-head">
                  <h3>Slots</h3>
                </div>
                <div className="theme-settings-row">
                  <div>
                    <strong>Progress word target</strong>
                    <p>Project progress summaries should stay brief.</p>
                  </div>
                  <div className="theme-settings-control">
                    <input
                      type="number"
                      min={1}
                      value={draft.submission.progress_word_target}
                      onChange={(event) => setDraft({
                        ...draft,
                        submission: { ...draft.submission, progress_word_target: Number.parseInt(event.target.value || '1', 10) || 1 },
                      })}
                    />
                  </div>
                </div>
                {themeMeetingSlotTypes.map((type) => (
                  <div className="theme-settings-row" key={type}>
                    <div>
                      <strong>{updateTypeLabels[type]}</strong>
                      <p>{updateTypeOptionLabels[type]}</p>
                    </div>
                    <div className="theme-settings-control">
                      <input
                        type="number"
                        min={0}
                        value={draft.submission.update_types[type]?.duration_minutes ?? 0}
                        onChange={(event) => updateSubmission(type, event.target.value)}
                      />
                    </div>
                  </div>
                ))}
              </section>
            </div>
          )}

          <section className="ops-panel theme-settings-themes">
            <div className="theme-settings-section-head themes-head">
              <div>
                <h3>Themes</h3>
                <p>{canEditGlobal ? 'All theme groups' : 'Your managed theme groups'}</p>
              </div>
              <span>{draft.themes.length} visible</span>
            </div>
            <div className="theme-settings-list">
              {draft.themes.map((theme) => {
                const canEditTheme = canEditGlobal || editableThemeIds.includes(theme.theme_id);
                const coordinatorUsername = theme.coordinator_user || '';
                const addableUsers = users.filter((nextUser) => !(theme.member_users || []).includes(nextUser.username));
                return (
                  <article className="theme-settings-card" key={theme.theme_id}>
                    <div className="theme-settings-card-head">
                      <div>
                        <span className="track-chip">Theme {theme.theme_id}</span>
                        <h4>{theme.title}</h4>
                      </div>
                      <span className="status-pill">{theme.cycle_group}</span>
                    </div>

                    {canEditGlobal ? (
                      <div className="theme-settings-fields">
                        <label className="theme-settings-field title-field">
                          <span>Title</span>
                          <input value={theme.title} onChange={(event) => updateTheme(theme.theme_id, { title: event.target.value })} />
                        </label>
                        <label className="theme-settings-field">
                          <span>Cycle</span>
                          <select value={theme.cycle_group} onChange={(event) => updateTheme(theme.theme_id, { cycle_group: event.target.value })}>
                            {draft.cycle.rotation.map((cycle) => (
                              <option key={cycle} value={cycle}>{cycle}</option>
                            ))}
                          </select>
                        </label>
                        <label className="theme-settings-field">
                          <span>Time</span>
                          <input type="time" value={theme.time} onChange={(event) => updateTheme(theme.theme_id, { time: event.target.value })} />
                        </label>
                        <label className="theme-settings-field">
                          <span>Duration</span>
                          <input
                            type="number"
                            min={1}
                            value={theme.duration_minutes}
                            onChange={(event) => updateTheme(theme.theme_id, { duration_minutes: Number.parseInt(event.target.value || '60', 10) || 60 })}
                          />
                        </label>
                        <label className="theme-settings-field coordinator-field">
                          <span>Coordinator</span>
                          <select
                            value={coordinatorUsername}
                            onChange={(event) => {
                              const username = event.target.value;
                              const nextMembers = username && !(theme.member_users || []).includes(username)
                                ? [...(theme.member_users || []), username]
                                : theme.member_users;
                              updateTheme(theme.theme_id, { coordinator_user: username, member_users: nextMembers });
                            }}
                          >
                            <option value="">Choose coordinator</option>
                            {users.map((nextUser) => (
                              <option key={nextUser.username} value={nextUser.username}>
                                {nextUser.displayName} (@{nextUser.username})
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : (
                      <div className="theme-settings-readonly-grid">
                        <div className="theme-settings-readonly"><span>Coordinator</span><strong>{theme.coordinator}</strong></div>
                        <div className="theme-settings-readonly"><span>Time</span><strong>{theme.weekday} {theme.time}</strong></div>
                      </div>
                    )}

                    <div className="theme-settings-members-block">
                      <label className="theme-settings-field">
                        <span>Members</span>
                        <select disabled={!canEditTheme || !addableUsers.length} value="" onChange={(event) => addMember(theme, event.target.value)}>
                          <option value="">{addableUsers.length ? 'Add active member' : 'No active members to add'}</option>
                          {addableUsers.map((nextUser) => (
                            <option key={nextUser.username} value={nextUser.username}>
                              {nextUser.displayName} (@{nextUser.username})
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="theme-settings-member-list">
                        {(theme.member_users || []).map((username) => (
                          <div className="theme-settings-member-row" key={username}>
                            <span>
                              <strong>{userByUsername.get(username)?.displayName || username}</strong>
                              <small>@{username}</small>
                            </span>
                            <button
                              aria-label={`Remove ${userByUsername.get(username)?.displayName || username}`}
                              type="button"
                              disabled={!canEditTheme || username === coordinatorUsername}
                              onClick={() => removeMember(theme, username)}
                            >
                              <Trash2 aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <p className="settings-footnote">{memberNames(theme.member_users)}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function AuditLogSettingsPanel() {
  const [day, setDay] = useState(() => auditLogDateKey());
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [days, setDays] = useState<AuditLogDay[]>([]);
  const [fileName, setFileName] = useState(`audit-${day}.jsonl`);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<AuditLogRecord | null>(null);
  const auditCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const logGroups = useMemo(() => groupedAuditDays(days), [days]);
  useCustomDialogFocus(Boolean(selectedLog), auditCloseButtonRef);

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
                      <td>{auditLogTime(log.eventTime)}</td>
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
            onKeyDown={(event) => trapCustomDialogFocus(event, () => setSelectedLog(null))}
          >
            <header>
              <div>
                <h2 id="audit-json-title">Audit entry</h2>
                <p>{selectedLog.action} · {auditLogTime(selectedLog.eventTime)}</p>
              </div>
              <button ref={auditCloseButtonRef} type="button" aria-label="Close" onClick={() => setSelectedLog(null)}>
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
  accentTheme,
  setAccentTheme,
  fontTheme,
  setFontTheme,
  onSaveThemeSettings,
  canManageUsers,
  canManageThemeSettings,
}: {
  user: CurrentUser;
  onUserChanged: (user: CurrentUser) => void;
  personalDetailsSignal: number;
  theme: ConsoleTheme;
  setTheme: (theme: ConsoleTheme) => void;
  accentTheme: ConsoleAccentTheme;
  setAccentTheme: (theme: ConsoleAccentTheme) => void;
  fontTheme: ConsoleFontTheme;
  setFontTheme: (font: ConsoleFontTheme) => void;
  onSaveThemeSettings: () => void;
  canManageUsers: boolean;
  canManageThemeSettings: boolean;
}) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
  const [userQuery, setUserQuery] = useState('');
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(() =>
    normalizedNotificationPreferences(user.notificationPreferences),
  );
  const [notificationPermission, setNotificationPermission] = useState<'default' | 'granted' | 'denied' | 'unsupported'>('unsupported');
  const [busyNotifications, setBusyNotifications] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [themeMessage, setThemeMessage] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [createDraft, setCreateDraft] = useState({
    username: '',
    displayName: '',
    email: '',
    position: 'student' as UserPosition,
    role: 'member' as CurrentUser['role'],
    aliasesText: '',
    temporaryPassword: '',
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyCreate, setBusyCreate] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const editCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const editingUser = users.find((user) => user.id === editingUserId) || null;
  const editingDraft = editingUser ? drafts[editingUser.id] || draftFromUser(editingUser) : null;
  const actionUser = actionUserId ? users.find((user) => user.id === actionUserId) || null : null;
  const canViewAudit = user.role === 'administrator';
  const canViewConfig = user.role === 'administrator';
  useCustomDialogFocus(createOpen, createCloseButtonRef);
  useCustomDialogFocus(Boolean(editingUser), editCloseButtonRef);

  useEffect(() => {
    setNotificationPrefs(normalizedNotificationPreferences(user.notificationPreferences));
  }, [user.notificationPreferences]);

  useEffect(() => {
    setNotificationPermission('Notification' in window ? Notification.permission : 'unsupported');
  }, []);

  const filteredUsers = useMemo(() => {
    const query = userQuery.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) => (
      user.displayName.toLowerCase().includes(query) ||
      user.username.toLowerCase().includes(query) ||
      roleLabel(user.role).toLowerCase().includes(query) ||
      positionLabel(user.position).toLowerCase().includes(query) ||
      user.aliases.some((alias) => alias.toLowerCase().includes(query))
    ));
  }, [userQuery, users]);
  const activeUserCount = users.filter((user) => user.provisioningStatus === 'active').length;

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
      (!canManageThemeSettings && settingsTab === 'themeMeeting') ||
      (!canManageUsers && settingsTab === 'users') ||
      (!canViewAudit && settingsTab === 'audit') ||
      (!canViewConfig && settingsTab === 'config')
    ) {
      setSettingsTab('general');
    }
  }, [canManageThemeSettings, canManageUsers, canViewAudit, canViewConfig, settingsTab]);

  useEffect(() => {
    setSettingsTab('general');
  }, [personalDetailsSignal]);

  useEffect(() => {
    if (!actionUserId) return undefined;

    const closeMenu = () => {
      setActionUserId(null);
      setActionMenuPosition(null);
    };

    window.addEventListener('resize', closeMenu);
    return () => {
      window.removeEventListener('resize', closeMenu);
    };
  }, [actionUserId]);

  function closeUserActions() {
    setActionUserId(null);
    setActionMenuPosition(null);
  }

  function toggleUserActions(event: MouseEvent<HTMLButtonElement>, userId: string) {
    if (actionUserId === userId) {
      closeUserActions();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const left = Math.max(
      rowMenuGutter,
      Math.min(window.innerWidth - rowMenuWidth - rowMenuGutter, rect.right - rowMenuWidth),
    );
    const preferredTop = rect.bottom + 8;
    const maxTop = window.innerHeight - rowMenuHeight - rowMenuGutter;
    const top = preferredTop > maxTop
      ? Math.max(rowMenuGutter, rect.top - rowMenuHeight - 8)
      : preferredTop;

    setActionMenuPosition({ top, left });
    setActionUserId(userId);
  }

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
          position: draft.position || null,
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
      closeUserActions();
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
          position: createDraft.position,
          aliases: aliasesFromText(createDraft.aliasesText),
          temporaryPassword: createDraft.temporaryPassword,
        }),
      });
      const body = (await response.json()) as UsersPayload;
      if (!response.ok || !body.users) {
        throw new Error(body.error || 'Could not create user.');
      }
      applyUsers(body.users);
      setCreateDraft({ username: '', displayName: '', email: '', position: 'student', role: 'member', aliasesText: '', temporaryPassword: '' });
      setCreateOpen(false);
      setMessage('Created user with a forced password reset.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create user.');
    } finally {
      setBusyCreate(false);
    }
  }

  function updateNotificationPreference(topic: NotificationPreferenceTopic, channel: keyof NotificationPreferenceChannels) {
    if (topic === 'chat_mentions' && channel === 'email') return;
    setNotificationPrefs((current) => ({
      ...current,
      [topic]: {
        ...current[topic],
        [channel]: !current[topic][channel],
        email: topic === 'chat_mentions' ? false : channel === 'email' ? !current[topic].email : current[topic].email,
      },
    }));
    setNotificationMessage(null);
    setNotificationError(null);
  }

  async function enableBrowserNotifications() {
    setNotificationError(null);
    setNotificationMessage(null);
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported');
      setNotificationError('This browser does not support notifications.');
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    setNotificationMessage(permission === 'granted' ? 'Browser notifications enabled.' : 'Browser notifications not enabled.');
  }

  async function saveNotificationPreferences() {
    setBusyNotifications(true);
    setNotificationError(null);
    setNotificationMessage(null);
    try {
      const response = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationPreferences: notificationPrefs }),
      });
      const body = (await response.json()) as AuthPayload;
      if (!response.ok || !body.user) {
        throw new Error(body.error || 'Could not save notification preferences.');
      }
      onUserChanged(body.user);
      setNotificationPrefs(normalizedNotificationPreferences(body.user.notificationPreferences));
      setNotificationMessage('Notification preferences saved.');
    } catch (caught) {
      setNotificationError(caught instanceof Error ? caught.message : 'Could not save notification preferences.');
    } finally {
      setBusyNotifications(false);
    }
  }

  function saveThemeSettings() {
    onSaveThemeSettings();
    setThemeMessage('Theme settings saved for this account on this browser.');
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
          closeUserActions();
          setCreateOpen(true);
        }}
      >
        <Plus aria-hidden="true" />
        Add member
      </button>
    </div>
  );

  const integrationRows = [
    { mark: 'OL', name: 'Overleaf', desc: 'Import LaTeX drafts for checklist runs.', status: 'Backlog' },
  ];
  return (
    <ConsolePageFrame
      title="Settings"
      className="users-page settings-page"
      wide
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
          {(canManageThemeSettings || canManageUsers || canViewAudit || canViewConfig) && (
            <>
              <div className="settings-sidebar-rule" />
              <div className="settings-sidebar-label">Administration</div>
              {canManageThemeSettings && (
                <button className={settingsTab === 'themeMeeting' ? 'active' : ''} type="button" onClick={() => setSettingsTab('themeMeeting')}>
                  <CalendarDays aria-hidden="true" />
                  <span>Theme meeting</span>
                  <KeyRound className="settings-lock-icon" aria-hidden="true" />
                </button>
              )}
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

        <div className={`settings-main ${settingsTab === 'themeMeeting' || settingsTab === 'users' || settingsTab === 'audit' || settingsTab === 'config' ? 'settings-main-wide' : ''}`}>
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
                    <h2>Theme Setting</h2>
                    <p>Personal Swift-style appearance settings for this account on this browser.</p>
                  </div>
                </div>
                <div className="theme-setting-panel">
                  <div className="theme-setting-row">
                    <div>
                      <strong>Mode</strong>
                      <p>Choose how VioScope appears on this device.</p>
                    </div>
                    <div className="ops-segmented" role="group" aria-label="Theme mode">
                      <button className={theme === 'light' ? 'selected' : ''} type="button" onClick={() => { setTheme('light'); setThemeMessage(null); }}>
                        Light
                      </button>
                      <button className={theme === 'dark' ? 'selected' : ''} type="button" onClick={() => { setTheme('dark'); setThemeMessage(null); }}>
                        Dark
                      </button>
                      <button className={theme === 'system' ? 'selected' : ''} type="button" onClick={() => { setTheme('system'); setThemeMessage(null); }}>
                        System
                      </button>
                    </div>
                  </div>
                  <div className="theme-setting-row">
                    <div>
                      <strong>Color scheme</strong>
                      <p>Accent palette used for navigation, buttons, chat bubbles, and states.</p>
                    </div>
                    <div className="theme-swatch-grid" role="radiogroup" aria-label="Color scheme">
                      {consoleAccentOptions.map((option) => (
                        <button
                          key={option.id}
                          className={accentTheme === option.id ? 'active' : ''}
                          type="button"
                          role="radio"
                          aria-checked={accentTheme === option.id}
                          onClick={() => {
                            setAccentTheme(option.id);
                            setThemeMessage(null);
                          }}
                        >
                          <span style={{ background: option.color }} aria-hidden="true" />
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="theme-setting-row">
                    <div>
                      <strong>Font</strong>
                      <p>Pick the console typeface family.</p>
                    </div>
                    <div className="theme-font-grid" role="radiogroup" aria-label="Font family">
                      {consoleFontOptions.map((option) => (
                        <button
                          key={option.id}
                          className={fontTheme === option.id ? 'active' : ''}
                          type="button"
                          role="radio"
                          aria-checked={fontTheme === option.id}
                          style={{ fontFamily: option.fontFamily }}
                          onClick={() => {
                            setFontTheme(option.id);
                            setThemeMessage(null);
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="theme-preview-card">
                    <span className="theme-preview-sidebar" aria-hidden="true" />
                    <div>
                      <strong>VioScope preview</strong>
                      <p>Cards, notifications, and chat bubbles follow this palette.</p>
                    </div>
                    <button className="ops-primary" type="button">
                      Action
                    </button>
                  </div>
                  {themeMessage && <div className="form-message">{themeMessage}</div>}
                  <div className="button-row">
                    <button className="ops-primary" type="button" onClick={saveThemeSettings}>
                      <Save aria-hidden="true" />
                      Save theme settings
                    </button>
                  </div>
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
                <div className="notification-grid-head">
                  <span>Situation</span>
                  <span>Web</span>
                  <span>Email</span>
                </div>
                {notificationPreferenceRows.map((row) => {
                  const prefs = notificationPrefs[row.key];
                  return (
                    <div className="settings-list-row notification-preference-row" key={row.key}>
                      <div>
                        <strong>{row.title}</strong>
                        <p>{row.desc}</p>
                      </div>
                      <div className="notification-channel-cell">
                        <button
                          className={`settings-switch ${prefs.web ? 'on' : ''}`}
                          type="button"
                          aria-label={`${row.title} web notifications`}
                          aria-pressed={prefs.web}
                          onClick={() => updateNotificationPreference(row.key, 'web')}
                        >
                          <span />
                        </button>
                      </div>
                      <div className="notification-channel-cell">
                        {row.emailDisabled ? (
                          <span className="settings-disabled-text">Web only</span>
                        ) : (
                          <button
                            className={`settings-switch ${prefs.email ? 'on' : ''}`}
                            type="button"
                            aria-label={`${row.title} email notifications`}
                            aria-pressed={prefs.email}
                            onClick={() => updateNotificationPreference(row.key, 'email')}
                          >
                            <span />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <section className="ops-panel settings-panel">
                <div className="preference-row">
                  <div>
                    <strong>Browser permission</strong>
                    <p>
                      {notificationPermission === 'unsupported'
                        ? 'This browser does not support system notifications.'
                        : `Current browser permission: ${notificationPermission}.`}
                    </p>
                  </div>
                  <button
                    className="ops-secondary"
                    type="button"
                    disabled={notificationPermission === 'unsupported' || notificationPermission === 'granted'}
                    onClick={() => void enableBrowserNotifications()}
                  >
                    <Bell aria-hidden="true" />
                    {notificationPermission === 'granted' ? 'Enabled' : 'Enable'}
                  </button>
                </div>
              </section>
              {notificationError && <div className="form-message error">{notificationError}</div>}
              {notificationMessage && <div className="form-message">{notificationMessage}</div>}
              <div className="button-row">
                <button className="ops-primary" type="button" disabled={busyNotifications} onClick={() => void saveNotificationPreferences()}>
                  <Save aria-hidden="true" />
                  {busyNotifications ? 'Saving' : 'Save notification settings'}
                </button>
              </div>
              <p className="settings-footnote">In-app alerts always appear under Alerts. Chat mentions are web-only; email is reserved for reminders and operational summaries.</p>
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
          ) : settingsTab === 'themeMeeting' ? (
            <ThemeMeetingSettingsPanel />
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
            <table className="ops-table ops-user-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Position</th>
                  <th>Permission</th>
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
                        <span className="position-pill">{positionLabel(user.position)}</span>
                      </td>
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
                          aria-expanded={actionUserId === user.id}
                          aria-haspopup="menu"
                          onClick={(event) => toggleUserActions(event, user.id)}
                        >
                          <MoreVertical aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!filteredUsers.length && (
                  <tr>
                    <td colSpan={8}>No members match this search.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {actionUser && actionMenuPosition && (
          <div className="row-menu row-menu-floating" role="menu" style={{ top: actionMenuPosition.top, left: actionMenuPosition.left }}>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setEditingUserId(actionUser.id);
                closeUserActions();
              }}
            >
              <Pencil aria-hidden="true" />
              Edit details
            </button>
            <button
              className={actionUser.provisioningStatus === 'disabled' ? '' : 'danger'}
              type="button"
              role="menuitem"
              disabled={busyId === actionUser.id}
              onClick={() => saveUser(actionUser, { provisioningStatus: actionUser.provisioningStatus === 'disabled' ? 'active' : 'disabled' })}
            >
              <Power aria-hidden="true" />
              {actionUser.provisioningStatus === 'disabled' ? 'Enable member' : 'Disable member'}
            </button>
          </div>
        )}
      </section>
      <p className="members-footnote">
        Permissions govern what each person sees. Administrators and PIs can delegate access; members cannot change their own permission.
      </p>
            </div>
          )}
        </div>
      </div>

      {createOpen && (
        <div className="users-modal-backdrop" role="presentation" onClick={() => setCreateOpen(false)}>
          <form
            className="users-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-user-title"
            onSubmit={createUser}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => trapCustomDialogFocus(event, () => setCreateOpen(false))}
          >
            <header>
              <h2 id="create-user-title">Add a member</h2>
              <button ref={createCloseButtonRef} type="button" aria-label="Close" onClick={() => setCreateOpen(false)}>
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
              <span>Position</span>
              <select
                value={createDraft.position}
                onChange={(event) => setCreateDraft((current) => ({ ...current, position: event.target.value as UserPosition }))}
              >
                {userPositionOptions.map((position) => (
                  <option key={position} value={position}>
                    {positionLabel(position)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Permission</span>
              <div className="role-picker">
                {userPermissionOptions.map((role) => (
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
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-user-title"
            onSubmit={(event) => {
              event.preventDefault();
              void saveUser(editingUser);
            }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => trapCustomDialogFocus(event, () => setEditingUserId(null))}
          >
            <header>
              <h2 id="edit-user-title">Edit member</h2>
              <button ref={editCloseButtonRef} type="button" aria-label="Close" onClick={() => setEditingUserId(null)}>
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
                <span>Position</span>
                <select
                  value={editingDraft.position}
                  onChange={(event) => setDraft(editingUser.id, { position: event.target.value as UserPosition | '' })}
                >
                  <option value="">Set position</option>
                  {userPositionOptions.map((position) => (
                    <option key={position} value={position}>
                      {positionLabel(position)}
                    </option>
                  ))}
                </select>
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
              <p>Permission and status are delegated here; members cannot change these from their account settings.</p>
              <label>
                <span>Permission</span>
                <div className="role-picker">
                  {userPermissionOptions.map((role) => (
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
  const [activeView, setActiveView] = useState<ActiveView>('briefing');
  const [theme, setTheme] = useState<ConsoleTheme>('light');
  const [accentTheme, setAccentTheme] = useState<ConsoleAccentTheme>('aegean');
  const [fontTheme, setFontTheme] = useState<ConsoleFontTheme>('public');
  const [themeReady, setThemeReady] = useState(false);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [personalDetailsSignal, setPersonalDetailsSignal] = useState(0);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [projectsPayload, setProjectsPayload] = useState<ProjectsPayload | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [themePayload, setThemePayload] = useState<ThemeMeetingPayload | null>(null);
  const [themeMeetingsLoading, setThemeMeetingsLoading] = useState(false);
  const [collaboratorUsers, setCollaboratorUsers] = useState<MentionableUser[]>([]);
  const [chatNotifications, setChatNotifications] = useState<ChatNotification[]>([]);
  const [openChatThreadId, setOpenChatThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectView = useCallback((view: ActiveView, replace = false) => {
    setAccountMenuOpen(false);
    setNotificationsOpen(false);
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
    const storedTheme = readStoredThemeSettings();
    setTheme(storedTheme.mode);
    setAccentTheme(storedTheme.accent);
    setFontTheme(storedTheme.font);
    applyConsoleAppearance(storedTheme);
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    applyConsoleAppearance({ mode: theme, accent: accentTheme, font: fontTheme });
  }, [accentTheme, fontTheme, theme, themeReady]);

  useEffect(() => {
    if (!themeReady || !user) return;
    const storedTheme = readStoredThemeSettings(user.id);
    setTheme(storedTheme.mode);
    setAccentTheme(storedTheme.accent);
    setFontTheme(storedTheme.font);
    applyConsoleAppearance(storedTheme);
  }, [themeReady, user?.id]);

  useEffect(() => {
    if (!themeReady || theme !== 'system' || typeof window === 'undefined') return undefined;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const syncSystemTheme = () => applyConsoleAppearance({ mode: 'system', accent: accentTheme, font: fontTheme });
    media.addEventListener('change', syncSystemTheme);
    return () => media.removeEventListener('change', syncSystemTheme);
  }, [accentTheme, fontTheme, theme, themeReady]);

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

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const response = await fetch('/api/projects?includeArchived=true');
      const nextPayload = (await response.json()) as ProjectsPayload;
      if (!response.ok) {
        throw new Error(nextPayload.error || 'Could not load projects.');
      }
      setProjectsPayload(nextPayload);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const loadCollaboratorUsers = useCallback(async () => {
    const response = await fetch('/api/chat/users');
    const body = (await response.json()) as MentionUsersPayload;
    if (!response.ok) {
      throw new Error(body.error || 'Could not load collaborator hints.');
    }
    setCollaboratorUsers(body.users || []);
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
      setProjectsPayload(null);
      setProjectsLoading(false);
      setCollaboratorUsers([]);
      setThemePayload(null);
      setThemeMeetingsLoading(false);
      setChatNotifications([]);
      return () => {
        cancelled = true;
      };
    }

    void loadProjects().catch((caught) => {
      if (!cancelled) {
        setError(caught instanceof Error ? caught.message : 'Could not load projects.');
      }
    });
    void loadCollaboratorUsers().catch((caught) => {
      if (!cancelled) {
        setError(caught instanceof Error ? caught.message : 'Could not load collaborator hints.');
      }
    });
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
  }, [loadChatNotifications, loadCollaboratorUsers, loadProjects, loadThemeMeetings, user]);

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
    setNotificationsOpen(false);
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
      { id: 'briefing' as const, label: 'Briefing', icon: LayoutDashboard },
      { id: 'projects' as const, label: 'Projects', icon: FileText },
      { id: 'chat' as const, label: 'Chat', icon: MessageCircle },
      { id: 'meeting' as const, label: 'Meeting', icon: CalendarDays },
      { id: 'checklists' as const, label: 'Checklists', icon: ClipboardList },
    ],
    [],
  );

  const unreadChatNotificationCount = chatNotifications.filter((notification) => !notification.readAt).length;
  const attentionProjectNotifications =
    projectsPayload?.projects?.filter((project) => project.lifecycle !== 'archived' && projectNeedsAttention(project)) || [];
  const canManageThemeSettings = user
    ? canSeeAllRole(user.role) || user.role === 'organizer' || Boolean(themePayload?.access?.canManageThemeIds?.length)
    : false;

  const bottomNavItems = useMemo(
    () => [{ id: 'users' as const, label: 'Settings', icon: Settings }],
    [],
  );

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
    setAccountMenuOpen(false);
    setNotificationsOpen(false);
    setProjectsPayload(null);
    setCollaboratorUsers([]);
    setThemePayload(null);
    setChatNotifications([]);
    setError(null);
    selectView('briefing', true);
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
          <img className="brand-mark" src="/art/VIOS_icon.jpg" alt="" aria-hidden="true" />
          <div>
            <strong>VioScope</strong>
            <small>VIOS Lab</small>
          </div>
        </div>
        <div className="account-block">
          <TopbarNotificationCenter
            open={notificationsOpen}
            activeCount={unreadChatNotificationCount}
            chatNotifications={chatNotifications}
            themeNotifications={themePayload?.notifications || []}
            attentionProjects={attentionProjectNotifications}
            onToggle={() => {
              setAccountMenuOpen(false);
              setNotificationsOpen((current) => !current);
            }}
            onOpenAlerts={() => {
              setNotificationsOpen(false);
              selectView('alerts');
            }}
            onOpenChatSession={openChatSessionFromNotification}
            onMarkAllMessagesRead={() => {
              void markAllChatNotificationsRead().catch((caught) => {
                setError(caught instanceof Error ? caught.message : 'Could not mark notifications as read.');
              });
            }}
          />
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
            onClick={() => {
              setNotificationsOpen(false);
              setAccountMenuOpen((current) => !current);
            }}
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
          {activeView === 'briefing' && (
            <BriefingView
              projectsPayload={projectsPayload}
              projectsLoading={projectsLoading}
              themePayload={themePayload}
              themeMeetingsLoading={themeMeetingsLoading}
              chatNotifications={chatNotifications}
              viewer={user}
              onOpenProjects={() => selectView('projects')}
              onOpenMeeting={() => selectView('meeting')}
              onOpenAlerts={() => selectView('alerts')}
            />
          )}
          {activeView === 'projects' && (
            <ProjectsView
              projectsPayload={projectsPayload}
              projectsLoading={projectsLoading}
              viewer={user}
              collaboratorUsers={collaboratorUsers}
              onProjectsChanged={loadProjects}
            />
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
              attentionProjects={attentionProjectNotifications}
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
              accentTheme={accentTheme}
              setAccentTheme={setAccentTheme}
              fontTheme={fontTheme}
              setFontTheme={setFontTheme}
              onSaveThemeSettings={() => saveStoredThemeSettings(user.id, { mode: theme, accent: accentTheme, font: fontTheme })}
              canManageUsers={user.role === 'administrator' || user.role === 'pi'}
              canManageThemeSettings={canManageThemeSettings}
            />
          )}
        </div>
      </div>
    </main>
  );
}
