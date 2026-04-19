import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [task = 'task', workspace = 'workspace'] = process.argv.slice(2);

const outputByTask = {
  build: join('build', '.placeholder'),
  test: join('coverage', '.placeholder')
};

const outputFile = outputByTask[task];

if (outputFile) {
  const target = join(process.cwd(), outputFile);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(
    target,
    'TODO(bootstrap): replace placeholder outputs with real build or test artifacts.\n'
  );
}

console.log(`[placeholder] ${task} for ${workspace}`);
console.log(
  'TODO(bootstrap): replace this placeholder during the matching implementation phase.'
);
