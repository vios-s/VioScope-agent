import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { deriveLabState, type DeriveLabStateOptions } from './derive';
import { labStateProjectSchema, labStateSchema, type DerivedLabState, type LabState, type LabStateProject } from './schema';

export type ReadLabStateOptions = DeriveLabStateOptions & {
  statePath?: string;
};

const defaultStages = {
  '1': 'idea/proposal',
  '2': 'design/scoping',
  '3': 'build/experiments',
  '4': 'writing/submission',
  '5': 'revision',
};

function todayString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function isInside(parent: string, child: string): boolean {
  const normalizedParent = resolve(parent);
  const normalizedChild = resolve(child);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

function candidateStatePaths(): string[] {
  const candidates: string[] = [];

  if (process.env.LAB_STATE_PATH) {
    candidates.push(process.env.LAB_STATE_PATH);
  }

  if (process.env.DATASTORE_DIR) {
    candidates.push(
      join(process.env.DATASTORE_DIR, 'lab-state.yaml'),
      join(process.env.DATASTORE_DIR, 'lab-state.yml'),
      join(process.env.DATASTORE_DIR, 'lab-state', 'lab-state.yaml'),
      join(process.env.DATASTORE_DIR, 'lab-state', 'lab-state.yml'),
      join(process.env.DATASTORE_DIR, 'lab-state'),
    );
  }

  return candidates;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveStatePath(inputPath?: string): Promise<string> {
  if (inputPath) {
    return resolve(process.cwd(), inputPath);
  }

  for (const candidate of candidateStatePaths()) {
    const resolved = resolve(process.cwd(), candidate);
    if (await pathExists(resolved)) {
      return resolved;
    }
  }

  throw new Error('No lab state file found. Set LAB_STATE_PATH or DATASTORE_DIR, or pass statePath explicitly.');
}

function assertAllowedStatePath(path: string) {
  const allowedRoots = [process.cwd()];

  if (process.env.DATASTORE_DIR) {
    allowedRoots.push(resolve(process.cwd(), process.env.DATASTORE_DIR));
  }

  if (!allowedRoots.some((root) => isInside(root, path))) {
    throw new Error('Lab state path must be inside the repository workspace or DATASTORE_DIR.');
  }
}

function parseLabStateYaml(content: string): LabState {
  return labStateSchema.parse(parseYaml(content));
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error('Markdown project state files must start with YAML frontmatter.');
  }

  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) {
    throw new Error('Markdown project state file has no closing frontmatter marker.');
  }

  return {
    frontmatter: normalized.slice(4, end),
    body: normalized.slice(end + 5).trim(),
  };
}

function parseProjectMarkdown(content: string): LabStateProject {
  const { frontmatter, body } = splitFrontmatter(content);
  const parsed = parseYaml(frontmatter);

  return labStateProjectSchema.parse({
    ...parsed,
    notes: parsed?.notes || body || undefined,
  });
}

async function readProjectMarkdownFiles(directory: string): Promise<LabStateProject[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const projectFiles = entries
    .filter((entry) => entry.isFile() && ['.md', '.markdown'].includes(extname(entry.name).toLowerCase()))
    .map((entry) => join(directory, entry.name))
    .sort();

  const projects: LabStateProject[] = [];
  for (const projectFile of projectFiles) {
    projects.push(parseProjectMarkdown(await readFile(projectFile, 'utf8')));
  }

  return projects;
}

async function readLabStateDirectory(directory: string): Promise<LabState> {
  const directYaml = [join(directory, 'lab-state.yaml'), join(directory, 'lab-state.yml')];
  for (const candidate of directYaml) {
    if (await pathExists(candidate)) {
      return parseLabStateYaml(await readFile(candidate, 'utf8'));
    }
  }

  const projectsDirectory = join(directory, 'projects');
  const projectDirectoryExists = await pathExists(projectsDirectory);
  const projects = await readProjectMarkdownFiles(projectDirectoryExists ? projectsDirectory : directory);

  if (!projects.length) {
    throw new Error(`No lab-state.yaml or project Markdown files found in ${directory}.`);
  }

  return labStateSchema.parse({
    meta: {
      updated: todayString(),
      stages: defaultStages,
    },
    projects,
  });
}

async function readRawLabState(path: string): Promise<LabState> {
  const metadata = await stat(path);

  if (metadata.isDirectory()) {
    return readLabStateDirectory(path);
  }

  if (!metadata.isFile()) {
    throw new Error(`Lab state path is not a file or directory: ${path}`);
  }

  const extension = extname(path).toLowerCase();
  const content = await readFile(path, 'utf8');

  if (extension === '.yaml' || extension === '.yml') {
    return parseLabStateYaml(content);
  }

  if (extension === '.md' || extension === '.markdown') {
    return labStateSchema.parse({
      meta: {
        updated: todayString(),
        stages: defaultStages,
      },
      projects: [parseProjectMarkdown(content)],
    });
  }

  throw new Error(`Unsupported lab state extension "${extension || '(none)'}". Use .yaml, .yml, or Markdown frontmatter.`);
}

export async function readLabState(options: ReadLabStateOptions = {}): Promise<{
  path: string;
  state: DerivedLabState;
}> {
  const statePath = await resolveStatePath(options.statePath);
  assertAllowedStatePath(statePath);

  const rawState = await readRawLabState(statePath);
  return {
    path: statePath,
    state: deriveLabState(rawState, options),
  };
}

export function filterLabState(
  state: DerivedLabState,
  filters: {
    owner?: string;
    status?: string;
    recommendation?: string;
  },
): DerivedLabState {
  const owner = filters.owner?.trim().toLowerCase();
  const status = filters.status?.trim();
  const recommendation = filters.recommendation?.trim();

  return {
    ...state,
    projects: state.projects.filter((project) => {
      if (owner && project.owner.toLowerCase() !== owner) return false;
      if (status && project.status !== status) return false;
      if (recommendation && project.derived.recommendation !== recommendation) return false;
      return true;
    }),
  };
}
