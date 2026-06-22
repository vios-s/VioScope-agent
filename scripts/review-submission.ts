import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { reviewSubmission } from '../src/mastra/submission/review';

type CliOptions = {
  draftPath?: string;
  skills: string[];
  targetVenue?: string;
  deadline?: string;
  out?: string;
  json?: boolean;
  jsonOut?: string;
  maxDraftChars?: number;
  maxOutputTokens?: number;
};

function printUsage() {
  console.log(`Usage: npm run review:submission -- <draft.md|draft.txt|draft.tex|deck.pptx> [options]

Options:
  --skill <name>        Add a skill to run. Repeatable. Defaults to all B2 private skills.
  --skills <a,b,c>      Comma-separated skill list.
  --target <venue>      Target venue or journal.
  --deadline <date>     Submission deadline or countdown note.
  --max-chars <n>       Maximum draft characters to send.
  --max-output <n>      Maximum output tokens.
  --out <path>          Write the Markdown report to a file instead of stdout.
  --json                Print the full structured result as JSON.
  --json-out <path>     Write the full structured result as JSON.

For machine-readable stdout via npm, use:
  npm --silent run review:submission -- <draft> --json
`);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { skills: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--skill') {
      options.skills.push(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === '--skills') {
      options.skills.push(...requireValue(args, index, arg).split(','));
      index += 1;
      continue;
    }

    if (arg === '--target') {
      options.targetVenue = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--deadline') {
      options.deadline = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--out') {
      options.out = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--json-out') {
      options.jsonOut = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--max-chars') {
      options.maxDraftChars = Number.parseInt(requireValue(args, index, arg), 10);
      index += 1;
      continue;
    }

    if (arg === '--max-output') {
      options.maxOutputTokens = Number.parseInt(requireValue(args, index, arg), 10);
      index += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.draftPath) {
      throw new Error(`Unexpected extra positional argument: ${arg}`);
    }

    options.draftPath = arg;
  }

  if (!options.draftPath) {
    printUsage();
    throw new Error('Missing draft path.');
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await reviewSubmission({
    draftPath: options.draftPath,
    skills: options.skills.length ? options.skills : undefined,
    targetVenue: options.targetVenue,
    deadline: options.deadline,
    maxDraftChars: options.maxDraftChars,
    maxOutputTokens: options.maxOutputTokens,
  });

  const report = `${result.report.trim()}

---

Harness metadata:
- Draft: ${result.draftName}
- Skills: ${result.skills.map((skill) => `${skill.name}${skill.version ? `@${skill.version}` : ''}`).join(', ')}
- Draft chars sent: ${result.draftChars}${result.draftTruncated ? ' (truncated)' : ''}
- Finish reason: ${result.finishReason}
`;

  if (options.out) {
    await writeFile(options.out, report, 'utf8');
  }

  if (options.jsonOut) {
    await writeFile(options.jsonOut, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (options.out) {
    console.log(`Wrote submission review report: ${options.out}`);
    if (options.jsonOut) {
      console.log(`Wrote structured submission review: ${options.jsonOut}`);
    }
    return;
  }

  if (options.jsonOut) {
    console.error(`Wrote structured submission review: ${options.jsonOut}`);
  }

  console.log(report);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
