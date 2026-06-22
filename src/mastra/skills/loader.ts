import { access, readdir, readFile, stat } from 'node:fs/promises';
import { basename, delimiter, dirname, join, relative, resolve } from 'node:path';

export const defaultViosSkillsDir = '';

export const validSkillCategories = [
  'Discovery & Monitoring',
  'Reading & Analysis',
  'Ideation & Hypothesis',
  'Methodology',
  'Domain: Medical Imaging',
  'Domain: Plant Phenotyping',
  'Domain: Causality',
  'Domain: Computer Vision',
  'Writing',
  'Review & Dissemination',
  'Community & Infrastructure',
] as const;

export type SkillIssueSeverity = 'warning' | 'error';

export type SkillIssue = {
  severity: SkillIssueSeverity;
  message: string;
  file?: string;
};

export type SkillFrontmatter = {
  name: string;
  category: string;
  description: string;
  version?: string;
  author?: string;
  license?: string;
};

export type ViosSkillSummary = SkillFrontmatter & {
  sourcePath: string;
  root: string;
};

export type ViosSkill = ViosSkillSummary & {
  body: string;
  markdown: string;
};

export type ViosSkillsLoadResult = {
  roots: string[];
  skills: ViosSkill[];
  issues: SkillIssue[];
};

type ParsedSkillFile = {
  frontmatter: Record<string, string>;
  body: string;
  markdown: string;
};

const skillNamePattern = /^[a-z0-9][a-z0-9-]*$/;
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function displayPath(path: string): string {
  const relativePath = relative(process.cwd(), path);
  return relativePath && !relativePath.startsWith('..') ? relativePath : path;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parseSkillMarkdown(markdown: string): ParsedSkillFile {
  const normalized = markdown.replace(/^\uFEFF/, '');

  if (!normalized.startsWith('---\n')) {
    throw new Error('SKILL.md must start with YAML frontmatter delimited by ---');
  }

  const closingIndex = normalized.indexOf('\n---', 4);
  if (closingIndex === -1) {
    throw new Error('SKILL.md frontmatter is missing the closing --- delimiter');
  }

  const frontmatterText = normalized.slice(4, closingIndex).trim();
  const body = normalized.slice(closingIndex + 4).replace(/^\s+/, '');
  const frontmatter: Record<string, string> = {};
  let currentKey: string | undefined;
  let blockMode: 'folded' | 'literal' | undefined;

  for (const rawLine of frontmatterText.split(/\r?\n/)) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    if (/^\s/.test(rawLine)) {
      if (!currentKey) {
        throw new Error(`Unsupported frontmatter line: ${rawLine}`);
      }

      const continuation = rawLine.trim();
      frontmatter[currentKey] =
        blockMode === 'literal'
          ? `${frontmatter[currentKey] || ''}${frontmatter[currentKey] ? '\n' : ''}${continuation}`
          : `${frontmatter[currentKey] || ''}${frontmatter[currentKey] ? ' ' : ''}${continuation}`;
      continue;
    }

    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(trimmedLine);
    if (!match) {
      throw new Error(`Unsupported frontmatter line: ${rawLine}`);
    }

    currentKey = match[1];
    const value = match[2].trim();

    if (['>', '>-', '>+'].includes(value)) {
      blockMode = 'folded';
      frontmatter[currentKey] = '';
    } else if (['|', '|-', '|+'].includes(value)) {
      blockMode = 'literal';
      frontmatter[currentKey] = '';
    } else {
      blockMode = undefined;
      frontmatter[currentKey] = stripQuotes(value);
    }
  }

  for (const [key, value] of Object.entries(frontmatter)) {
    frontmatter[key] = stripQuotes(value.trim());
  }

  return { frontmatter, body, markdown: normalized };
}

function validateFrontmatter(
  frontmatter: Record<string, string>,
  folderName: string,
  file: string,
): { metadata?: SkillFrontmatter; issues: SkillIssue[] } {
  const issues: SkillIssue[] = [];
  const name = frontmatter.name?.trim();
  const category = frontmatter.category?.trim();
  const description = frontmatter.description?.trim();
  const version = frontmatter.version?.trim();

  if (!name) {
    issues.push({ severity: 'error', file, message: 'Missing required frontmatter field: name' });
  } else {
    if (!skillNamePattern.test(name)) {
      issues.push({ severity: 'error', file, message: `Invalid skill name "${name}"; use kebab-case` });
    }

    if (name !== folderName) {
      issues.push({
        severity: 'error',
        file,
        message: `Skill name "${name}" must match folder name "${folderName}"`,
      });
    }
  }

  if (!category) {
    issues.push({ severity: 'error', file, message: 'Missing required frontmatter field: category' });
  } else if (!validSkillCategories.includes(category as (typeof validSkillCategories)[number])) {
    issues.push({ severity: 'error', file, message: `Invalid category "${category}"` });
  }

  if (!description) {
    issues.push({ severity: 'error', file, message: 'Missing required frontmatter field: description' });
  } else {
    if (!description.startsWith('Use this skill')) {
      issues.push({ severity: 'error', file, message: 'Description must start with "Use this skill"' });
    }

    if (description.length < 100) {
      issues.push({ severity: 'error', file, message: 'Description should be at least 100 characters' });
    }
  }

  if (version && !versionPattern.test(version)) {
    issues.push({ severity: 'error', file, message: `Version "${version}" is not valid semantic versioning` });
  }

  if (issues.some((issue) => issue.severity === 'error') || !name || !category || !description) {
    return { issues };
  }

  return {
    issues,
    metadata: {
      name,
      category,
      description,
      version,
      author: frontmatter.author?.trim() || undefined,
      license: frontmatter.license?.trim() || undefined,
    },
  };
}

function configuredSkillRootSpecs(): string[] {
  const config =
    process.env.VIOS_SKILLS_DIR ||
    (process.env.DATASTORE_DIR
      ? [
          join(process.env.DATASTORE_DIR, 'skills', 'vios-research-skills'),
          join(process.env.DATASTORE_DIR, 'skills', 'vios-private-skills'),
        ].join(delimiter)
      : defaultViosSkillsDir);
  return config
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function collectSkillFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const rootSkillFile = join(root, 'SKILL.md');

  if (basename(root) !== 'skills' && (await pathExists(rootSkillFile))) {
    files.push(rootSkillFile);
  }

  const nestedSkillsDir = join(root, 'skills');
  const scanRoot = (await isDirectory(nestedSkillsDir)) ? nestedSkillsDir : root;
  const entries = await readdir(scanRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }

    const skillFile = join(scanRoot, entry.name, 'SKILL.md');
    if (await pathExists(skillFile)) {
      files.push(skillFile);
    }
  }

  return files;
}

export function getConfiguredViosSkillRoots(): string[] {
  return configuredSkillRootSpecs().map((entry) => resolve(/* turbopackIgnore: true */ process.cwd(), entry));
}

export async function loadViosSkills(): Promise<ViosSkillsLoadResult> {
  const roots = getConfiguredViosSkillRoots();
  const issues: SkillIssue[] = [];
  const skillsByName = new Map<string, ViosSkill>();

  for (const root of roots) {
    if (!(await isDirectory(root))) {
      issues.push({
        severity: 'warning',
        message: `Configured skills directory does not exist: ${displayPath(root)}`,
      });
      continue;
    }

    const skillFiles = await collectSkillFiles(root);

    for (const file of skillFiles) {
      const sourcePath = displayPath(file);
      let parsed: ParsedSkillFile;

      try {
        parsed = parseSkillMarkdown(await readFile(file, 'utf8'));
      } catch (error) {
        issues.push({
          severity: 'error',
          file: sourcePath,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const validation = validateFrontmatter(parsed.frontmatter, basename(dirname(file)), sourcePath);
      issues.push(...validation.issues);

      if (!validation.metadata) {
        continue;
      }

      const existing = skillsByName.get(validation.metadata.name);
      if (existing) {
        issues.push({
          severity: 'warning',
          file: sourcePath,
          message: `Overrides skill "${validation.metadata.name}" from ${existing.sourcePath}`,
        });
      }

      skillsByName.set(validation.metadata.name, {
        ...validation.metadata,
        root: displayPath(root),
        sourcePath,
        body: parsed.body,
        markdown: parsed.markdown,
      });
    }
  }

  return {
    roots: roots.map(displayPath),
    skills: [...skillsByName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    issues,
  };
}

export async function listViosSkillSummaries(): Promise<ViosSkillsLoadResult & { summaries: ViosSkillSummary[] }> {
  const result = await loadViosSkills();
  return {
    ...result,
    summaries: result.skills.map(({ body: _body, markdown: _markdown, ...summary }) => summary),
  };
}

export async function readViosSkill(name: string): Promise<{ skill?: ViosSkill; result: ViosSkillsLoadResult }> {
  if (!skillNamePattern.test(name)) {
    throw new Error(`Invalid skill name "${name}"; use kebab-case`);
  }

  const result = await loadViosSkills();
  return {
    skill: result.skills.find((skill) => skill.name === name),
    result,
  };
}
