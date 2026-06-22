import 'dotenv/config';
import { renderThemeMeetingSummary, summarizeLabState } from '../src/mastra/state/derive';
import { readLabState } from '../src/mastra/state/loader';

async function main() {
  const { path, state } = await readLabState({
    statePath: 'fixtures/lab-state.example.yaml',
    today: new Date('2026-06-20T00:00:00.000Z'),
  });
  const summary = summarizeLabState(state);

  if (summary.totalProjects !== 3) {
    throw new Error(`Expected 3 example projects, got ${summary.totalProjects}.`);
  }

  if (summary.byRecommendation.deep_dive < 1) {
    throw new Error('Expected at least one deep_dive recommendation.');
  }

  if (summary.byRecommendation.nudge < 1) {
    throw new Error('Expected at least one nudge recommendation.');
  }

  const markdown = renderThemeMeetingSummary(state, summary);
  if (!markdown.includes('causal-widget') || !markdown.includes('report-assistant')) {
    throw new Error('Theme-meeting summary is missing expected attention projects.');
  }

  console.log(`Lab state check passed: ${path}`);
  console.log(
    JSON.stringify(
      {
        totalProjects: summary.totalProjects,
        byStatus: summary.byStatus,
        byRecommendation: summary.byRecommendation,
        attentionProjects: summary.projectsNeedingAttention.map((project) => project.project),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
