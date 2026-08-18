import 'dotenv/config';
import { NextResponse } from 'next/server';
import { requireSessionUser } from '../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { buildProjectPlanningReport } from '../../../../src/mastra/projects/planning';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    return NextResponse.json({ report: await buildProjectPlanningReport(user) });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const report = await buildProjectPlanningReport(user);
    await recordAuditLog({
      actor: user,
      action: 'project.planning_scan',
      targetType: 'project_planning',
      targetId: null,
      summary: 'User ran project planning scan.',
      metadata: {
        cycleStart: report.cycleStart,
        activeProjectCount: report.activeProjectCount,
        attentionCount: report.attentionItems.length,
        updatedCount: report.updatedProjects.length,
      },
    });
    return NextResponse.json({ report });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
