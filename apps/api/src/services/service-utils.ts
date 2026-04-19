import { randomUUID } from 'node:crypto';

import type { AnalyticsEvent } from '@operator-os/contracts';

export const createAnalyticsEvent = (
  category: AnalyticsEvent['category'],
  action: string,
  subjectId: string,
  metadata: AnalyticsEvent['metadata'] = {}
): AnalyticsEvent => ({
  id: randomUUID(),
  category,
  action,
  subjectId,
  occurredAt: new Date().toISOString(),
  metadata
});
