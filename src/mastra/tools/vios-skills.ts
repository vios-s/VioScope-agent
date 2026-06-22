import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { listViosSkillSummaries, readViosSkill, validSkillCategories } from '../skills/loader';

const issueSchema = z.object({
  severity: z.enum(['warning', 'error']),
  message: z.string(),
  file: z.string().optional(),
});

const skillSummarySchema = z.object({
  name: z.string(),
  category: z.string(),
  description: z.string(),
  version: z.string().optional(),
  author: z.string().optional(),
  license: z.string().optional(),
  sourcePath: z.string(),
  root: z.string(),
});

export const listViosSkillsTool = createTool({
  id: 'list-vios-skills',
  description:
    'List configured VioScope runtime skills from VIOS_SKILLS_DIR. Use before choosing a checklist or review skill for pre-submission, review, writing, or research workflow tasks.',
  inputSchema: z.object({
    category: z.enum(validSkillCategories).optional().describe('Optional skill category filter.'),
    includeIssues: z.boolean().default(false).describe('Include loader warnings and validation errors.'),
  }),
  outputSchema: z.object({
    roots: z.array(z.string()),
    skills: z.array(skillSummarySchema),
    issues: z.array(issueSchema).optional(),
  }),
  mcp: {
    annotations: {
      title: 'List VIOS Skills',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  execute: async ({ category, includeIssues }) => {
    const result = await listViosSkillSummaries();
    const skills = category ? result.summaries.filter((skill) => skill.category === category) : result.summaries;

    return {
      roots: result.roots,
      skills,
      issues: includeIssues ? result.issues : undefined,
    };
  },
});

export const readViosSkillTool = createTool({
  id: 'read-vios-skill',
  description:
    'Read one configured VioScope runtime skill by name. Use after list-vios-skills when you need to run a specific checklist, review workflow, or research skill.',
  inputSchema: z.object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).describe('Skill name in kebab-case.'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    skill: skillSummarySchema.optional(),
    markdown: z.string().optional(),
    issues: z.array(issueSchema),
  }),
  mcp: {
    annotations: {
      title: 'Read VIOS Skill',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  execute: async ({ name }) => {
    const { skill, result } = await readViosSkill(name);

    return {
      found: Boolean(skill),
      skill: skill
        ? {
            name: skill.name,
            category: skill.category,
            description: skill.description,
            version: skill.version,
            author: skill.author,
            license: skill.license,
            sourcePath: skill.sourcePath,
            root: skill.root,
          }
        : undefined,
      markdown: skill?.markdown,
      issues: result.issues,
    };
  },
  toModelOutput: (output) => ({
    type: 'text',
    value: output.found
      ? output.markdown || 'Skill was found, but no Markdown content was returned.'
      : 'Skill was not found in the configured VIOS_SKILLS_DIR roots.',
  }),
});
