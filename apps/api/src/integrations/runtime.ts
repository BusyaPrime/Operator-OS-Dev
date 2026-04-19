import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ServiceCheck } from '@operator-os/contracts';

export interface AdcStatus {
  available: boolean;
  message: string;
  path?: string;
  source: 'env' | 'metadata' | 'well-known-file' | 'missing';
}

const buildCheck = (
  name: string,
  status: ServiceCheck['status'],
  message: string,
  details?: ServiceCheck['details']
): ServiceCheck => ({
  name,
  status,
  message,
  details
});

export const buildConfiguredCheck = (
  name: string,
  message: string,
  details?: ServiceCheck['details']
) => buildCheck(name, 'ok', message, details);

export const buildDegradedCheck = (
  name: string,
  message: string,
  details?: ServiceCheck['details']
) => buildCheck(name, 'degraded', message, details);

export const buildNotConfiguredCheck = (
  name: string,
  message: string,
  details?: ServiceCheck['details']
) => buildCheck(name, 'not_configured', message, details);

export const detectApplicationDefaultCredentials = (): AdcStatus => {
  if (process.env.K_SERVICE) {
    return {
      available: true,
      source: 'metadata',
      message: 'Cloud Run metadata-backed ADC should be available at runtime.'
    };
  }

  const explicitPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (explicitPath && fs.existsSync(explicitPath)) {
    return {
      available: true,
      source: 'env',
      path: explicitPath,
      message: 'ADC discovered through GOOGLE_APPLICATION_CREDENTIALS.'
    };
  }

  const candidates = [
    process.env.APPDATA
      ? path.join(
          process.env.APPDATA,
          'gcloud',
          'application_default_credentials.json'
        )
      : undefined,
    path.join(
      os.homedir(),
      '.config',
      'gcloud',
      'application_default_credentials.json'
    )
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return {
        available: true,
        source: 'well-known-file',
        path: candidate,
        message: 'ADC discovered in the local gcloud well-known credentials path.'
      };
    }
  }

  return {
    available: false,
    source: 'missing',
    message:
      'Application Default Credentials are not configured. Run "gcloud auth application-default login" locally or use a Cloud Run service identity.'
  };
};

export type IntegrationErrorCode =
  | 'invalid_config'
  | 'missing_adc'
  | 'missing_iam'
  | 'upstream_error';

export class IntegrationError extends Error {
  readonly code: IntegrationErrorCode;
  readonly dependency: string;
  readonly details?: Record<string, unknown>;
  readonly statusCode: number;

  constructor(options: {
    code: IntegrationErrorCode;
    dependency: string;
    details?: Record<string, unknown>;
    message: string;
    statusCode: number;
  }) {
    super(options.message);
    this.code = options.code;
    this.dependency = options.dependency;
    this.details = options.details;
    this.statusCode = options.statusCode;
  }
}

export const normalizeErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : 'Unknown integration error';
};

export const mapGoogleIntegrationError = (
  dependency: string,
  error: unknown
): IntegrationError => {
  const message = normalizeErrorMessage(error);
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes('default credentials') ||
    lowerMessage.includes('could not load the default credentials')
  ) {
    return new IntegrationError({
      code: 'missing_adc',
      dependency,
      message:
        'Application Default Credentials are missing. Run "gcloud auth application-default login" locally or use an attached Cloud Run service account.',
      statusCode: 503
    });
  }

  if (
    lowerMessage.includes('permission') ||
    lowerMessage.includes('access denied') ||
    lowerMessage.includes('permission_denied') ||
    lowerMessage.includes('forbidden')
  ) {
    return new IntegrationError({
      code: 'missing_iam',
      dependency,
      message:
        'The configured identity does not have enough IAM permissions for this dependency.',
      statusCode: 403,
      details: { upstreamMessage: message }
    });
  }

  if (
    lowerMessage.includes('not found') ||
    lowerMessage.includes('invalid') ||
    lowerMessage.includes('unsupported')
  ) {
    return new IntegrationError({
      code: 'invalid_config',
      dependency,
      message:
        'The dependency configuration is invalid or incomplete. Verify project, region, model, bucket, queue, or secret names.',
      statusCode: 400,
      details: { upstreamMessage: message }
    });
  }

  return new IntegrationError({
    code: 'upstream_error',
    dependency,
    message: `${dependency} returned an unexpected error.`,
    statusCode: 502,
    details: { upstreamMessage: message }
  });
};
