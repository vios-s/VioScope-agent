import 'dotenv/config';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, requireSessionUser } from '../../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { setThemeAgendaSubscription } from '../../../../src/mastra/db/theme-agenda-subscriptions';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { readThemeMeetingConfig } from '../../../../src/mastra/theme-meetings/store';
import { isThemeAgendaSubscriptionRequired } from '../../../../src/mastra/theme-meetings/agenda-recipients';

export const runtime = 'nodejs';

const subscriptionSchema = z.object({ themeId: z.string().trim().min(1), subscribed: z.boolean() }).strict();

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser(request);
    if (user.role === 'service') throw new AuthError('A personal account is required.', 403, 'forbidden');
    const { themeId, subscribed } = subscriptionSchema.parse(await request.json());
    const { config } = await readThemeMeetingConfig();
    if (!config.themes.some((theme) => theme.theme_id === themeId)) {
      return NextResponse.json({ error: 'Unknown theme.' }, { status: 400 });
    }
    if (isThemeAgendaSubscriptionRequired(config, themeId, user.username)) {
      if (!subscribed) {
        throw new AuthError('Members, coordinators and PIs are automatically subscribed to their theme agendas and cannot unsubscribe individually.', 403, 'subscription_required');
      }
      return NextResponse.json({ themeId, subscribed: true, required: true });
    }
    await setThemeAgendaSubscription(user.id, themeId, subscribed);
    await recordAuditLog({
      actor: user,
      action: 'theme_meeting.agenda_subscription_update',
      targetType: 'theme_agenda_subscription',
      targetId: themeId,
      summary: subscribed ? 'Subscribed to a theme agenda.' : 'Unsubscribed from a theme agenda.',
      metadata: { themeId, subscribed },
    });
    return NextResponse.json({ themeId, subscribed });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
