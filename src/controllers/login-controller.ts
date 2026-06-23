import { VForm } from 'vuetify/components'

interface SisLoginResponse {
  data: {
    access_token: string
    refresh_token: string
    user: {
      id: string
      email: string
      name: string
    }
    org: {
      org_id: string
      role: string
      status: string
    } | null
  }
  message: string
}

interface ApprovalProfileResponse {
  success: boolean
  code: number
  message: string
  data: {
    id: string
    role: number
    firstName: string
    lastName: string
    position: { name: string } | null
  }
}

export function loginController() {
    definePage({
      meta: {
        layout: 'blank',
        unauthenticatedOnly: false,
      },
    })

    const isPasswordVisible = ref(false)
    const route = useRoute()
    const router = useRouter()

    const refVForm = ref<VForm>()
    const isLoginError = ref(false)
    const loginErrorMessage = ref('')
    const isAccountInactive = ref(false)
    const isInProgress = ref(false)

    const credentials = ref({
      email: '',
      password: '',
      remember: false,
    })

const login = async () => {
  try {
    // Step 1: authenticate against SIS (Shifd Identity Service) — Approval
    // Backend no longer issues tokens itself.
    const sisResult = await sisApi<SisLoginResponse>('/api/auth/login', {
      method: 'POST',
      body: {
        email: credentials.value.email,
        password: credentials.value.password,
      },
    })

    const sisData = sisResult?.data
    if (!sisData) {
      isInProgress.value = false
      isLoginError.value = true
      loginErrorMessage.value = 'Login failed. Please try again.'
      return
    }

    useCookie('accessToken').value = sisData.access_token
    useCookie('refreshToken').value = sisData.refresh_token
    useCookie('name').value = sisData.user.name
    useCookie('userId').value = sisData.user.id

    // User has no active org membership yet — nothing to do in Approval.
    if (!sisData.org) {
      isInProgress.value = false
      window.location.href = '/access-restricted?reason=org_missing'
      return
    }

    // Step 2: fetch the Approval-specific profile (role/position) so the
    // existing admin/reguler routing and UserProfile display keep working
    // unchanged. Uses the SIS access_token we just stored as the Bearer.
    const { data: profileRes, error: profileError } = await useApi<ApprovalProfileResponse>('/user/profile')

    if (profileError.value || !profileRes.value?.data) {
      isInProgress.value = false
      isLoginError.value = true
      loginErrorMessage.value = 'Gagal memuat profil pengguna. Silakan coba lagi.'
      return
    }

    const profile = profileRes.value.data

    isAccountInactive.value = false
    isLoginError.value = false
    loginErrorMessage.value = ''

    useCookie('role').value = `${profile.role}`
    useCookie('jobPosition').value = profile.position?.name ?? ''

    await nextTick(() => {
      window.location.href = profile.role === 99 ? '/admin/users' : '/reguler/dashboard'
    })
  } catch (err) {
    isInProgress.value = false
    isLoginError.value = true
    isAccountInactive.value = false

    const sisErr = parseSisError(err)

    switch (sisErr.code) {
      case 'INVALID_CREDENTIALS':
        loginErrorMessage.value = 'Email atau password salah.'
        break
      case 'ACCOUNT_LOCKED':
        isAccountInactive.value = true
        loginErrorMessage.value = 'Akun terkunci karena terlalu banyak percobaan gagal. Hubungi administrator.'
        break
      case 'FORBIDDEN':
        loginErrorMessage.value = 'Anda bukan member aktif organisasi ini.'
        break
      case 'RATE_LIMIT_EXCEEDED':
        loginErrorMessage.value = 'Terlalu banyak percobaan login. Coba lagi beberapa saat lagi.'
        break
      case 'VALIDATION_ERROR':
        loginErrorMessage.value = 'Email atau password tidak valid.'
        break
      default:
        loginErrorMessage.value = sisErr.message || 'Login gagal. Silakan coba lagi.'
    }
  }
}

      const onSubmit = () => {
        refVForm.value?.validate()
          .then(({ valid: isValid }) => {
            if (isValid) {
              isInProgress.value = true
              setTimeout(() => {
                isLoginError.value = false
                login()
              }, 1500)
            }
          })
      }

      return {
        isPasswordVisible,
        route,
        router,
        refVForm,
        isLoginError,
        loginErrorMessage,
        isAccountInactive,
        isInProgress,
        credentials,
        login,
        onSubmit
      }
}
