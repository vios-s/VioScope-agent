import { z } from 'zod';

export const projectStatusSchema = z.enum(['on_track', 'blocked', 'stale', 'needs_input']);
export const projectRecommendationSchema = z.enum(['deep_dive', 'nudge', 'none']);
export const projectSignalSchema = z.enum([
  'blocked_status',
  'blocker_present',
  'needs_input_status',
  'stale_status',
  'no_recent_update',
  'long_time_in_stage',
  'missing_last_update',
  'missing_stage_since',
]);

const dateStringSchema = z
  .union([z.string(), z.date()])
  .transform((value) => {
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }

    return value;
  })
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.'));

const projectStageSchema = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === 'number' ? value : Number.parseInt(value, 10)))
  .pipe(z.number().int().min(1).max(5));

const nullableTextSchema = z
  .preprocess((value) => (value === undefined ? null : value), z.string().trim().min(1).nullable())
  .default(null);

export const labStateDerivedSchema = z.object({
  weeks_in_stage: z.number().int().nonnegative().nullable(),
  days_since_update: z.number().int().nonnegative().nullable(),
  recommendation: projectRecommendationSchema,
  signals: z.array(projectSignalSchema),
});

export const labStateProjectSchema = z.object({
  project: z.string().trim().min(1),
  owner: z.string().trim().min(1),
  collaborators: z.array(z.string().trim().min(1)).default([]),
  track: z.string().trim().min(1).default('general'),
  stage: projectStageSchema,
  status: projectStatusSchema,
  stage_since: dateStringSchema.nullable().default(null),
  last_update: dateStringSchema.nullable().default(null),
  blocker: nullableTextSchema,
  target: nullableTextSchema,
  venue: nullableTextSchema,
  submission_deadline: dateStringSchema.nullable().default(null),
  watch_path: nullableTextSchema,
  artifacts: z.array(z.string().trim().min(1)).default([]),
  notes: z.string().trim().optional(),
  derived: labStateDerivedSchema.optional(),
});

export const labStateMetaSchema = z.object({
  updated: dateStringSchema,
  stages: z.record(z.string(), z.string()).default({
    '1': 'idea/proposal',
    '2': 'design/scoping',
    '3': 'build/experiments',
    '4': 'writing/submission',
    '5': 'revision',
  }),
});

export const labStateSchema = z.object({
  meta: labStateMetaSchema,
  projects: z.array(labStateProjectSchema),
});

export const derivedLabStateProjectSchema = labStateProjectSchema.extend({
  derived: labStateDerivedSchema,
});

export const derivedLabStateSchema = labStateSchema.extend({
  projects: z.array(derivedLabStateProjectSchema),
});

export const labStateSummarySchema = z.object({
  totalProjects: z.number().int().nonnegative(),
  byStatus: z.record(projectStatusSchema, z.number().int().nonnegative()),
  byRecommendation: z.record(projectRecommendationSchema, z.number().int().nonnegative()),
  projectsNeedingAttention: z.array(derivedLabStateProjectSchema),
});

export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type ProjectRecommendation = z.infer<typeof projectRecommendationSchema>;
export type LabState = z.infer<typeof labStateSchema>;
export type LabStateProject = z.infer<typeof labStateProjectSchema>;
export type DerivedLabState = z.infer<typeof derivedLabStateSchema>;
export type DerivedLabStateProject = z.infer<typeof derivedLabStateProjectSchema>;
export type LabStateSummary = z.infer<typeof labStateSummarySchema>;
