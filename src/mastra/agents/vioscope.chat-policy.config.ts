export const vioscopeChatPolicyConfig = {
  scopeRefusal:
    'VioScope is limited to VIOS lab work, lab wiki knowledge, EIDF/RDS/server setup, theme meetings, projects, and review/checklist workflows. I cannot help with general news or other non-lab topics here.',
  labScopeTerms: [
    'vios',
    'vioscope',
    'lab',
    'wiki',
    'gitbook',
    'eidf',
    'rds',
    'server',
    'vm',
    'gpu',
    'safe',
    'theme',
    'meeting',
    'project',
    'paper',
    'submission',
    'review',
    'checklist',
    'leave',
    'holiday',
    'annual leave',
    'pi',
    'supervisor',
    'team',
    'policy',
    'procedure',
    'account',
    'access',
  ],
  obviousOutOfScopeTerms: [
    'us news',
    'uk news',
    'world news',
    'headline',
    'headlines',
    'weather',
    'sport',
    'sports',
    'stock',
    'stocks',
    'stock market',
    'crypto',
    'bitcoin',
    'election',
    'politics',
    'president',
    'celebrity',
    'movie',
    'recipe',
  ],
  practicalWikiQueryTerms: [
    'book',
    'booking',
    'ticket',
    'train',
    'travel',
    'expense',
    'expenses',
    'claim',
    'absence',
    'leave',
    'holiday',
    'account',
    'access',
    'email',
    'building',
    'room',
    'desk',
    'software',
    'server',
    'gpu',
    'rds',
    'eidf',
  ],
  wikiQueryExpansionTerms: [
    'university',
    'lab',
    'institutional',
    'guidance',
    'policy',
    'procedure',
    'induction',
    'business travel',
    'expenses',
    'booking',
    'access',
    'account',
    'absence',
    'HR',
  ],
} as const;

const termPatterns = new Map<string, RegExp>();

function termPattern(term: string) {
  const key = term.toLowerCase();
  const existing = termPatterns.get(key);
  if (existing) return existing;

  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
  termPatterns.set(key, pattern);
  return pattern;
}

export function matchesChatPolicyTerms(input: string, terms: readonly string[]) {
  return terms.some((term) => termPattern(term).test(input));
}
