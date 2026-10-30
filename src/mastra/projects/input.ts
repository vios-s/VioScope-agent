import type { ProjectCreateInput } from '../db/projects';

const projectWriteFields = [
  'project',
  'title',
  'ownerUsername',
  'collaborators',
  'piUsername',
  'pdraUsername',
  'piUsernames',
  'pdraUsernames',
  'track',
  'stage',
  'stageProgress',
  'lifecycle',
  'status',
  'stageSince',
  'lastUpdate',
  'blocker',
  'target',
  'venue',
  'submissionDeadline',
  'watchPath',
  'notes',
  'todos',
] as const;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('Expected text value.');
  return value.trim() || null;
}

function textArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const values = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(values) || values.some((item) => typeof item !== 'string')) {
    throw new Error('Expected a list of usernames.');
  }
  return values.map((item) => item.trim()).filter(Boolean);
}

function integer(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error('Expected an integer value.');
  return parsed;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error('Expected a boolean value.');
  return value;
}

function todoArray(value: unknown): ProjectCreateInput['todos'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('Expected a list of TODO items.');
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Expected a TODO item.');
    const todo = item as Record<string, unknown>;
    return {
      id: text(todo.id),
      text: text(todo.text),
      dueDate: optionalText(todo.dueDate),
      done: optionalBoolean(todo.done),
      createdAt: text(todo.createdAt),
      updatedAt: text(todo.updatedAt),
    };
  });
}

export function parseProjectInput(value: unknown): ProjectCreateInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a project object.');
  }
  const body = value as Record<string, unknown>;
  return {
    project: text(body.project),
    title: text(body.title),
    ownerUsername: text(body.ownerUsername),
    collaborators: textArray(body.collaborators),
    piUsername: optionalText(body.piUsername),
    pdraUsername: optionalText(body.pdraUsername),
    piUsernames: textArray(body.piUsernames),
    pdraUsernames: textArray(body.pdraUsernames),
    track: text(body.track),
    stage: integer(body.stage),
    stageProgress: integer(body.stageProgress),
    lifecycle: text(body.lifecycle) as ProjectCreateInput['lifecycle'],
    status: text(body.status) as ProjectCreateInput['status'],
    stageSince: optionalText(body.stageSince),
    lastUpdate: optionalText(body.lastUpdate),
    blocker: optionalText(body.blocker),
    target: optionalText(body.target),
    venue: optionalText(body.venue),
    submissionDeadline: optionalText(body.submissionDeadline),
    watchPath: optionalText(body.watchPath),
    notes: optionalText(body.notes),
    todos: todoArray(body.todos),
  };
}

export function changedProjectFields(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a project object.');
  }
  const body = value as Record<string, unknown>;
  return projectWriteFields.filter((field) => body[field] !== undefined);
}
