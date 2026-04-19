import type { AuthSession } from '@operator-os/contracts';

import { apiClient } from './api-client';

export const authSessionClient = {
  getCurrentSession: async (): Promise<AuthSession> => {
    const dashboard = await apiClient.getOperatorDashboard();
    return dashboard.payload.auth;
  }
};
