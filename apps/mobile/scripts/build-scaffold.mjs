import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outputDir = join(process.cwd(), 'build');
mkdirSync(outputDir, { recursive: true });

writeFileSync(
  join(outputDir, 'scaffold-manifest.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      app: 'Operator OS Mobile',
      screens: ['Home', 'Devices', 'Sessions', 'Costs', 'Settings'],
      note: 'Bootstrap scaffold manifest. Native release packaging is not configured yet.'
    },
    null,
    2
  )
);

console.log('Wrote mobile scaffold manifest to build/scaffold-manifest.json');
