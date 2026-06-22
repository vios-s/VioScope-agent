import 'dotenv/config';
import { loadViosSkills } from '../src/mastra/skills/loader';

async function main() {
  const requireSkills = process.argv.includes('--require');
  const result = await loadViosSkills();
  const errorCount = result.issues.filter((issue) => issue.severity === 'error').length;

  console.log(`Configured VIOS skill root(s): ${result.roots.join(', ') || 'none'}`);
  console.log(`Loaded ${result.skills.length} skill(s).`);

  for (const skill of result.skills) {
    console.log(`- ${skill.name} [${skill.category}] ${skill.version ? `v${skill.version}` : ''}`.trim());
  }

  for (const issue of result.issues) {
    const file = issue.file ? `${issue.file}: ` : '';
    console.log(`${issue.severity.toUpperCase()}: ${file}${issue.message}`);
  }

  if (requireSkills && result.skills.length === 0) {
    throw new Error('No VIOS skills were loaded, and --require was passed.');
  }

  if (errorCount > 0) {
    throw new Error(`VIOS skills validation failed with ${errorCount} error(s).`);
  }

  if (result.skills.length === 0) {
    console.log('No skills are configured yet. This is OK before the B2 skill repository is mounted.');
  }

  console.log('VIOS skills check passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
