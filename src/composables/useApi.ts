import { createFetch } from '@vueuse/core'
import { destr } from 'destr'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

export const useApi = createFetch({
  baseUrl: API_BASE_URL,
  fetchOptions: {
    headers: {
      Accept: 'application/json',
    },
    credentials: 'include', // Include cookies for CORS requests
  },
  options: {
    refetch: true,
    async beforeFetch({ options }) {
      let accessToken = useCookie('accessToken').value

      if (accessToken) {
        if (isJwtExpired(accessToken)) {
          try {
            await refreshingToken()
            accessToken = useCookie('accessToken').value

            // If still no valid token after refresh, stop request
            if (!accessToken || isJwtExpired(accessToken)) {
              throw new Error('Token refresh failed or still expired.')
            }
          } catch (err) {
            console.error('Token refresh error:', err)
            throw err // Let the caller handle the failure (e.g. redirect to login)
          }
        }

        // Attach access token to headers
        options.headers = {
          ...options.headers,
          Authorization: `Bearer ${accessToken}`,
        }
      }

      return { options }
    },
    afterFetch(ctx) {
      const { data, response } = ctx

      let parsedData = null
      try {
        parsedData = destr(data)
      } catch (error) {
        console.error('Failed to parse response:', error)
      }

      return { data: parsedData, response }
    },
    onFetchError(ctx) {
      // Parse error response body to extract custom error messages
      const { data, response } = ctx

      let parsedError: any = null
      try {
        parsedError = destr(data)
      } catch (error) {
        console.error('Failed to parse error response:', error)
      }

      // If we successfully parsed the error response, attach it
      if (parsedError) {
        ctx.data = parsedError
        ctx.error = parsedError
      }

      handleAuthErrorCode(parsedError?.errorCode)

      return ctx
    },
  },
})

// Refresh happens against SIS, not Approval Backend — Approval no longer
// issues or refreshes tokens. SIS's refresh endpoint is public: the
// refresh_token itself is the credential, no Authorization header needed.
const refreshingToken = async () => {
  try {
    const response = await sisApi<{ data: { access_token: string }, message: string }>('/api/auth/refresh', {
      method: 'POST',
      body: {
        refresh_token: useCookie('refreshToken').value,
      },
    })

    const accessToken = response?.data?.access_token
    if (accessToken) {
      useCookie('accessToken').value = accessToken
    } else {
      throw new Error('No access_token in refresh response.')
    }
  } catch (err) {
    console.error('❌ Refresh token failed:', err)
    useCookie('accessToken').value = null
    useCookie('refreshToken').value = null
    throw err
  }
}

// Reacts to the machine-readable `errorCode` the backend attaches to auth
// failures (see approval-backend config/middleware/jwks_middleware.go).
// All other errors keep using their existing per-call handling — this only
// covers the three codes the auth/subscription middleware can produce.
function handleAuthErrorCode(errorCode?: string) {
  if (!errorCode)
    return

  const currentPath = window.location.pathname

  if (errorCode === 'UNAUTHORIZED') {
    if (currentPath === '/')
      return // already on login

    useCookie('accessToken').value = null
    useCookie('refreshToken').value = null
    window.location.href = '/'
    return
  }

  if (currentPath === '/access-restricted')
    return // avoid redirect loop

  if (errorCode === 'SUBSCRIPTION_INACTIVE')
    window.location.href = '/access-restricted?reason=subscription_inactive'
  else if (errorCode === 'ORG_MISSING')
    window.location.href = '/access-restricted?reason=org_missing'
}

// Reads the org_id claim straight off the cached SIS access token, for call
// sites that need "the org the logged-in user is currently in" without a
// server round-trip (e.g. SIS's org-membership endpoints, which take org_id
// in the URL path rather than inferring it server-side).
export function getCurrentOrgId(): string | null {
  const token = useCookie('accessToken').value
  if (!token) return null

  try {
    const payloadBase64 = token.split('.')[1]
    const payload = JSON.parse(atob(payloadBase64))
    return payload.org_id ?? null
  } catch (error) {
    console.error('Invalid token or decode error:', error)
    return null
  }
}

function isJwtExpired(token: string): boolean {
  try {
    const payloadBase64 = token.split('.')[1]
    const payload = JSON.parse(atob(payloadBase64))

    if (!payload.exp) {
      throw new Error("Token missing 'exp' field.")
    }

    const currentTime = Math.floor(Date.now() / 1000)
    return currentTime >= payload.exp
  } catch (error) {
    console.error('Invalid token or decode error:', error)
    return true
  }
}
