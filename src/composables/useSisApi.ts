import { FetchError, ofetch } from 'ofetch'

// SIS (Shifd Identity Service) — owns login/register/refresh/logout/password
// recovery. Its response envelope is intentionally different from Approval
// Backend's: success is `{ data, message }`, error is `{ error, code }` with
// a SNAKE_CASE string code (see /Users/kompasid/Desktop/API.md). Approval's
// `useApi` composable assumes Approval's own envelope, so SIS calls go
// through this separate, unwrapped client instead.
const SIS_BASE_URL = import.meta.env.VITE_SIS_BASE_URL || 'http://localhost:8080'

export const sisApi = ofetch.create({
  baseURL: SIS_BASE_URL,
  headers: {
    Accept: 'application/json',
  },
})

export interface SisErrorBody {
  message: string
  code: string
}

// SIS error codes actually used in code (see API.md §1).
export type SisErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'ACCOUNT_LOCKED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'EMAIL_ALREADY_EXISTS'
  | 'SLUG_ALREADY_EXISTS'
  | 'ALREADY_MEMBER'
  | 'RATE_LIMIT_EXCEEDED'
  | 'INTERNAL_ERROR'
  | 'UNKNOWN'

// ofetch throws on non-2xx by default; the thrown FetchError's `.data` is the
// parsed `{ error, code }` body. Normalize it to `{ message, code }` so
// callers don't need to know ofetch's error shape.
export function parseSisError(err: unknown): SisErrorBody {
  if (err instanceof FetchError && err.data && typeof err.data === 'object') {
    const body = err.data as { error?: string; code?: string }
    return {
      message: body.error || 'Terjadi kesalahan. Silakan coba lagi.',
      code: (body.code as SisErrorCode) || 'UNKNOWN',
    }
  }
  return { message: 'Terjadi kesalahan. Silakan coba lagi.', code: 'UNKNOWN' }
}
