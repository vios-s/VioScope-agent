import { copyFile, mkdir, readdir, cp } from 'node:fs/promises';
import { join } from 'node:path';

const promptsDir = join(process.cwd(), 'src', 'mastra', 'prompts');
const outputDir = join(process.cwd(), '.mastra', 'output');

await mkdir(outputDir, { recursive: true });

for (const fileName of await readdir(promptsDir)) {
  if (fileName.endsWith('.yaml')) {
    await copyFile(join(promptsDir, fileName), join(outputDir, fileName));
  }
}

await cp(join(promptsDir, 'idea-pitch'), join(outputDir, 'idea-pitch'), { recursive: true });
