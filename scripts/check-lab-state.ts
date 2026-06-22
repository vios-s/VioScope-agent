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

  const toyProject = state.projects.find((project) => project.project === 'toy-segmentation');
  if (!toyProject) {
    throw new Error('Expected toy-segmentation in example lab state.');
  }
  if (!toyProject.collaborators.includes('bob') || !toyProject.collaborators.includes('charlie')) {
    throw new Error('Expected toy-segmentation collaborators to be parsed.');
  }
  if (toyProject.venue !== 'ToyConf') {
    throw new Error(`Expected toy-segmentation venue ToyConf, got ${toyProject.venue}.`);
  }
  if (toyProject.submission_deadline !== '2026-09-15') {
    throw new Error(`Expected toy-segmentation submission deadline, got ${toyProject.submission_deadline}.`);
  }

  const markdown = renderThemeMeetingSummary(state, summary);
  if (!markdown.includes('causal-widget') || !markdown.includes('report-assistant')) {
    throw new Error('Theme-meeting summary is missing expected attention projects.');
  }
  if (!markdown.includes('venue internal demo') || !markdown.includes('deadline 2026-07-01')) {
    throw new Error('Theme-meeting summary is missing venue/deadline context.');
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
