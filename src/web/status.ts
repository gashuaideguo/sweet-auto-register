import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config/loadConfig.js';

export type ActiveJob = {
  type: 'automation' | 'sync';
  startedAt: string;
} | null;

type ArtifactStatus = {
  registerCount: number;
  cpaCount: number;
  hasCurrentPhone: boolean;
  screenshotCount: number;
};

type SanitizedConfigStatus = {
  configFileExists: boolean;
  startUrlConfigured: boolean;
  smsProvider: string;
  syncEnabled: boolean;
  syncHostConfigured: boolean;
  syncRemotePathConfigured: boolean;
  oauthClientIdConfigured: boolean;
  oauthRedirect: {
    host: string;
    port: number;
    path: string;
  };
};

export type ServiceStatus = {
  now: string;
  cwd: string;
  activeJob: ActiveJob;
  artifacts: ArtifactStatus;
  config: SanitizedConfigStatus;
};

function countFiles(directory: string, extension?: string): number {
  if (!fs.existsSync(directory)) {
    return 0;
  }

  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (!extension || entry.name.endsWith(extension)))
    .length;
}

function getArtifactStatus(): ArtifactStatus {
  const authDirectory = path.join(process.cwd(), 'auth');

  return {
    registerCount: countFiles(path.join(authDirectory, 'register'), '.json'),
    cpaCount: countFiles(path.join(authDirectory, 'cpa'), '.json'),
    hasCurrentPhone: fs.existsSync(path.join(authDirectory, 'phone', 'current.json')),
    screenshotCount: countFiles(path.join(authDirectory, 'screenshots')),
  };
}

function getConfigStatus(): SanitizedConfigStatus {
  const config = loadConfig();

  return {
    configFileExists: fs.existsSync(path.join(process.cwd(), 'config.yaml')),
    startUrlConfigured: config.startUrl.trim().length > 0,
    smsProvider: config.sms.provider,
    syncEnabled: config.sync.enabled,
    syncHostConfigured: config.sync.host.trim().length > 0,
    syncRemotePathConfigured: config.sync.remotePath.trim().length > 0,
    oauthClientIdConfigured: config.oauth.clientId.trim().length > 0,
    oauthRedirect: {
      host: config.oauth.redirectHost,
      port: config.oauth.redirectPort,
      path: config.oauth.redirectPath,
    },
  };
}

export function getServiceStatus(activeJob: ActiveJob): ServiceStatus {
  return {
    now: new Date().toISOString(),
    cwd: process.cwd(),
    activeJob,
    artifacts: getArtifactStatus(),
    config: getConfigStatus(),
  };
}
