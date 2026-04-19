import { z } from 'zod';

export const isoTimestampSchema = z.string().datetime();

export const metadataSchema = z.record(z.string(), z.unknown());

export const environmentSchema = z.enum(['development', 'test', 'production']);
