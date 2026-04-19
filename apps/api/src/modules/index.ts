import { alertsModule } from './alerts/index.js';
import { analyticsModule } from './analytics/index.js';
import { authModule } from './auth/index.js';
import { commandsModule } from './commands/index.js';
import { exportsModule } from './exports/index.js';
import { providersModule } from './providers/index.js';
import { sessionsModule } from './sessions/index.js';
import { storageModule } from './storage/index.js';
import { telemetryModule } from './telemetry/index.js';
import { vertexModule } from './vertex/index.js';

export const operatorModules = [
  authModule,
  commandsModule,
  sessionsModule,
  analyticsModule,
  alertsModule,
  exportsModule,
  providersModule,
  vertexModule,
  telemetryModule,
  storageModule
] as const;
