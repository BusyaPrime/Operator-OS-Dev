import type { ServiceCheck } from '@operator-os/contracts';

import type { OperatorModule } from '../types.js';

export const createStubModule = (
  name: OperatorModule['name'],
  message: string,
  status: ServiceCheck['status'] = 'not_configured'
): OperatorModule => ({
  name,
  describeReadiness: () => ({
    name,
    status,
    message
  })
});
