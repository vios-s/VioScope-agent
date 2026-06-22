import { z } from 'zod';

const dateStringSchema = z
  .union([z.string(), z.date()])
  .transform((value) => {
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }

    return value;
  })
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.'));

const timeStringSchema = z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM.');

export const themeUpdateTypeSchema = z.enum(['nothing_to_report', 'short_update', 'deep_dive']);
export const themeReminderActionSchema = z.enum([
  'first_reminder',
  'gentle_missing_update_reminder',
  'agenda_cutoff',
  'manual_missing_update_reminder',
]);

export const themeMeetingConfigSchema = z.object({
  timezone: z.string().trim().min(1).default('Europe/London'),
  cycle: z.object({
    weekday: z.string().trim().min(1).default('Wednesday'),
    rotation: z.array(z.string().trim().min(1)).min(1),
    anchor_date: dateStringSchema,
  }),
  pis: z.array(z.string().trim().min(1)).default([]),
  pi_users: z.array(z.string().trim().min(1)).default([]),
  administrator: z.string().trim().min(1).nullable().default(null),
  administrator_user: z.string().trim().min(1).nullable().default(null),
  themes: z
    .array(
      z.object({
        theme_id: z.string().trim().min(1),
        title: z.string().trim().min(1),
        cycle_group: z.string().trim().min(1),
        weekday: z.string().trim().min(1).default('Wednesday'),
        time: timeStringSchema,
        duration_minutes: z.number().int().positive().default(60),
        coordinator: z.string().trim().min(1),
        coordinator_user: z.string().trim().min(1).optional(),
        coordinator_aliases: z.array(z.string().trim().min(1)).default([]),
        members: z.array(z.string().trim().min(1)).min(1),
        member_users: z.array(z.string().trim().min(1)).optional(),
      }),
    )
    .min(1),
  submission: z
    .object({
      progress_word_target: z.number().int().positive().default(30),
      update_types: z.record(
        themeUpdateTypeSchema,
        z.object({
          duration_minutes: z.number().int().nonnegative(),
          questions_required: z.boolean(),
        }),
      ),
    })
    .default({
      progress_word_target: 30,
      update_types: {
        nothing_to_report: { duration_minutes: 0, questions_required: false },
        short_update: { duration_minutes: 10, questions_required: true },
        deep_dive: { duration_minutes: 30, questions_required: true },
      },
    }),
  reminders: z.array(z.record(z.string(), z.unknown())).default([]),
  permissions: z.record(z.string(), z.array(z.string())).default({}),
  notification_backlog: z.array(z.string()).default([]),
});

export const themeMeetingUpdateSchema = z.object({
  meeting_date: dateStringSchema,
  theme_id: z.string().trim().min(1),
  member: z.string().trim().min(1),
  update_type: themeUpdateTypeSchema,
  progress_text: z.string().trim().min(1),
  questions: z.string().trim().default(''),
  submitted_at: z.string().datetime(),
  submitted_via: z.enum(['dashboard', 'chat', 'cron', 'api']).default('api'),
  member_username: z.string().trim().min(1).optional(),
});

export const themeMeetingUpdatesFileSchema = z.object({
  updates: z.array(themeMeetingUpdateSchema).default([]),
});

export const themeMeetingAgendaItemSchema = z.object({
  meeting_date: dateStringSchema,
  theme_id: z.string(),
  theme_title: z.string(),
  member: z.string(),
  member_username: z.string().optional(),
  update_type: themeUpdateTypeSchema,
  duration_minutes: z.number().int().nonnegative(),
  progress_text: z.string(),
  questions: z.string(),
  submitted_at: z.string().datetime(),
});

export const themeMeetingPlanSchema = z.object({
  meeting_date: dateStringSchema,
  timezone: z.string(),
  cycle_group: z.string(),
  generated_at: z.string().datetime(),
  meetings: z.array(
    z.object({
      theme_id: z.string(),
      title: z.string(),
      time: z.string(),
      duration_minutes: z.number().int().positive(),
      coordinator: z.string(),
      coordinator_username: z.string().optional(),
      members: z.array(z.string()),
      member_usernames: z.array(z.string()).default([]),
      submitted_members: z.array(z.string()),
      submitted_member_usernames: z.array(z.string()).default([]),
      missing_members: z.array(z.string()),
      missing_member_usernames: z.array(z.string()).default([]),
      nothing_to_report_members: z.array(z.string()),
      nothing_to_report_member_usernames: z.array(z.string()).default([]),
      agenda_items: z.array(themeMeetingAgendaItemSchema),
      planned_minutes: z.number().int().nonnegative(),
      overbooked: z.boolean(),
    }),
  ),
});

export const themeMeetingNotificationSchema = z.object({
  id: z.string(),
  action: themeReminderActionSchema,
  meeting_date: dateStringSchema,
  cycle_group: z.string(),
  theme_id: z.string(),
  member: z.string(),
  member_username: z.string().optional(),
  title: z.string(),
  body: z.string(),
  created_at: z.string().datetime(),
  read: z.boolean().default(false),
});

export const themeMeetingNotificationsFileSchema = z.object({
  notifications: z.array(themeMeetingNotificationSchema).default([]),
});

export type ThemeMeetingConfig = z.infer<typeof themeMeetingConfigSchema>;
export type ThemeMeetingUpdate = z.infer<typeof themeMeetingUpdateSchema>;
export type ThemeMeetingUpdatesFile = z.infer<typeof themeMeetingUpdatesFileSchema>;
export type ThemeMeetingPlan = z.infer<typeof themeMeetingPlanSchema>;
export type ThemeMeetingAgendaItem = z.infer<typeof themeMeetingAgendaItemSchema>;
export type ThemeMeetingNotification = z.infer<typeof themeMeetingNotificationSchema>;
export type ThemeReminderAction = z.infer<typeof themeReminderActionSchema>;
export type ThemeUpdateType = z.infer<typeof themeUpdateTypeSchema>;
