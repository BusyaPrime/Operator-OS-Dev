import { parseDesktopAgentEnv } from '@operator-os/config';

export const getDesktopAgentConfig = () => parseDesktopAgentEnv(process.env);
