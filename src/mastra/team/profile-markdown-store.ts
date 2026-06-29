import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { runtimeEnv } from '../runtime-config';

const maxTeamProfileMarkdownChars = 500_000;

const placeholderMarkdown = `# VIOS public team profile cache

Source: https://github.com/vios-s/vios.science/tree/main/src/content/team

## Summary

This file is the editable VioScope cache for public team profile data.

## Group name

### Display Name
- Source id: username.md
- Role: role or title
- Research interests: topic one; topic two
- Public links:
  - Website: https://example.com
- Public info:
  - Short public profile note.
`;

export function teamProfileMarkdownPath(): string {
  const configuredPath = runtimeEnv('TEAM_PROFILE_MARKDOWN').trim();
  if (configuredPath) return resolve(configuredPath);

  const datastoreDir = runtimeEnv('DATASTORE_DIR').trim();
  return datastoreDir
    ? resolve(datastoreDir, 'team', 'vios-team-public.md')
    : join(tmpdir(), 'vioscope-agent', 'team', 'vios-team-public.md');
}

export async function readTeamProfileMarkdown(): Promise<{ path: string; markdown: string; exists: boolean }> {
  const path = teamProfileMarkdownPath();
  try {
    return { path, markdown: await readFile(path, 'utf8'), exists: true };
  } catch {
    return { path, markdown: placeholderMarkdown, exists: false };
  }
}

export async function writeTeamProfileMarkdown(markdown: string): Promise<{ path: string; markdown: string }> {
  if (markdown.length > maxTeamProfileMarkdownChars) {
    throw new Error('Team profile markdown is too large.');
  }

  const path = teamProfileMarkdownPath();
  const cleanMarkdown = `${markdown.trimEnd()}\n`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, cleanMarkdown, 'utf8');
  return { path, markdown: cleanMarkdown };
}
