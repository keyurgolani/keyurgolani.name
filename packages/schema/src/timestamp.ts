import { z } from 'zod';

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Whether a string is an ISO 8601 timestamp with a time zone, such as 2026-10-21T09:30:00Z. */
export function isTimestamp(value: string): boolean {
  return TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

/** An ISO 8601 timestamp with a time zone, such as 2026-10-21T09:30:00Z. */
export const TimestampSchema = z.string().refine(isTimestamp, {
  message: 'must be an ISO 8601 timestamp with a time zone, such as 2026-10-21T09:30:00Z.',
});
