export type PublicTeamLink = {
  label: string;
  url: string;
};

export type PublicTeamProfile = {
  name: string;
  username: string;
  group: string;
  role: string;
  sourceId: string;
  researchInterests: string[];
  publicLinks: PublicTeamLink[];
  publicInfo: string[];
};

function slugifyUsername(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.+/g, '.');

  return slug || 'user';
}

function parseIndentedLink(line: string): PublicTeamLink | null {
  const match = line.match(/^\s{2}-\s+([^:]+):\s+(.+)$/);
  if (!match) {
    return null;
  }

  return {
    label: match[1].trim(),
    url: match[2].trim(),
  };
}

function parseIndentedText(line: string): string | null {
  const match = line.match(/^\s{2}-\s+(.+)$/);
  return match?.[1]?.trim() || null;
}

export function parsePublicTeamProfilesMarkdown(markdown: string): PublicTeamProfile[] {
  const profiles: PublicTeamProfile[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let group = '';
  let current: PublicTeamProfile | null = null;
  let mode: 'links' | 'info' | null = null;

  const flush = () => {
    if (!current) {
      return;
    }

    current.username = slugifyUsername(current.name);
    profiles.push(current);
    current = null;
    mode = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
      flush();
      const heading = trimmed.slice(3).trim();
      if (heading !== 'Summary') {
        group = heading;
      }
      continue;
    }

    if (trimmed.startsWith('### ')) {
      flush();
      current = {
        name: trimmed.slice(4).trim(),
        username: '',
        group,
        role: 'not listed',
        sourceId: '',
        researchInterests: [],
        publicLinks: [],
        publicInfo: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (trimmed.startsWith('- Source id:')) {
      current.sourceId = trimmed.slice('- Source id:'.length).trim();
      mode = null;
      continue;
    }

    if (trimmed.startsWith('- Role:')) {
      current.role = trimmed.slice('- Role:'.length).trim();
      mode = null;
      continue;
    }

    if (trimmed.startsWith('- Research interests:')) {
      current.researchInterests = trimmed
        .slice('- Research interests:'.length)
        .split(';')
        .map((interest) => interest.trim())
        .filter(Boolean);
      mode = null;
      continue;
    }

    if (trimmed === '- Public links:') {
      mode = 'links';
      continue;
    }

    if (trimmed === '- Public info:') {
      mode = 'info';
      continue;
    }

    if (mode === 'links') {
      const link = parseIndentedLink(line);
      if (link) {
        current.publicLinks.push(link);
      }
      continue;
    }

    if (mode === 'info') {
      const info = parseIndentedText(line);
      if (info) {
        current.publicInfo.push(info);
      }
    }
  }

  flush();
  return profiles.filter((profile) => profile.name && profile.group);
}
