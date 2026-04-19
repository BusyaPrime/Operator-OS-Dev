import { z } from 'zod';

export const nodeEnvSchema = z
  .enum(['development', 'test', 'production'])
  .default('development');

export const booleanFromString = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return defaultValue;
      }

      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    });

export const integerFromString = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined ? defaultValue : Number.parseInt(value, 10)
    )
    .pipe(z.number().int().positive());

export const optionalUrlFromString = () =>
  z.preprocess((value) => {
    if (typeof value !== 'string') {
      return value;
    }

    const normalized = value.trim();
    return normalized.length === 0 ? undefined : normalized;
  }, z.string().url().optional());
