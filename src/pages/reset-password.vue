<script setup lang="ts">
import { VNodeRenderer } from '@layouts/components/VNodeRenderer';
import { themeConfig } from '@themeConfig';
import { VForm } from 'vuetify/components';
import { sisApi, parseSisError } from '@/composables/useSisApi';

definePage({
  meta: {
    layout: 'blank',
  },
})

const { t } = useI18n()
const route = useRoute()

const refVForm = ref<VForm>()
const newPassword = ref('')
const confirmPassword = ref('')
const isNewPasswordVisible = ref(false)
const isConfirmPasswordVisible = ref(false)
const isLoading = ref(false)
const isSuccess = ref(false)
const isError = ref(false)
const errorMessage = ref('')

const token = computed(() => route.query.token as string | undefined)
const hasToken = computed(() => !!token.value)

const confirmPasswordRules = computed(() => [
  requiredValidator,
  (v: string) => v === newPassword.value || t('common.passwordMismatch'),
])

const onSubmit = () => {
  refVForm.value?.validate().then(async ({ valid }) => {
    if (!valid) return

    isLoading.value = true
    isError.value = false

    try {
      await sisApi('/api/auth/reset-password', {
        method: 'POST',
        body: {
          token: token.value,
          new_password: newPassword.value,
        },
      })
      isSuccess.value = true
    } catch (e) {
      isError.value = true
      const { code } = parseSisError(e)
      if (code === 'VALIDATION_ERROR') {
        errorMessage.value = t('auth.resetPasswordComplexity')
      } else if (code === 'RATE_LIMIT_EXCEEDED') {
        errorMessage.value = t('auth.error429')
      } else if (code === 'TOKEN_EXPIRED' || code === 'TOKEN_INVALID') {
        errorMessage.value = t('auth.resetTokenExpired')
      } else {
        errorMessage.value = t('auth.resetError')
      }
    } finally {
      isLoading.value = false
    }
  })
}
</script>

<template>
  <div class="auth-wrapper d-flex align-center justify-center pa-4">
    <div class="position-relative my-sm-16">
      <VCard
        class="auth-card"
        max-width="460"
        :class="$vuetify.display.smAndUp ? 'pa-6' : 'pa-0'"
      >
        <VCardItem class="justify-center">
          <VCardTitle>
            <RouterLink to="/">
              <div class="app-logo">
                <VNodeRenderer :nodes="themeConfig.app.logo" />
              </div>
            </RouterLink>
          </VCardTitle>
        </VCardItem>

        <!-- ───── Invalid / missing token ───── -->
        <template v-if="!hasToken">
          <VCardText class="text-center pt-2 pb-6 px-6">
            <div class="mb-5">
              <VIcon icon="tabler-link-off" size="52" color="error" />
            </div>
            <h4 class="text-h5 font-weight-bold mb-2">
              {{ t('auth.invalidToken') }}
            </h4>
            <p class="text-body-1 text-medium-emphasis mb-6">
              {{ t('auth.invalidTokenMsg') }}
            </p>
            <RouterLink to="/forgot-password">
              <VBtn block color="primary" prepend-icon="tabler-refresh">
                {{ t('auth.requestNewLink') }}
              </VBtn>
            </RouterLink>
          </VCardText>
        </template>

        <!-- ───── Success state ───── -->
        <template v-else-if="isSuccess">
          <VCardText class="text-center pt-2 pb-6 px-6">
            <div class="mb-5">
              <VIcon icon="tabler-circle-check" size="52" color="success" />
            </div>
            <h4 class="text-h5 font-weight-bold mb-2">
              {{ t('auth.resetSuccessTitle') }}
            </h4>
            <p class="text-body-1 text-medium-emphasis mb-6">
              {{ t('auth.resetSuccessMsg') }}
            </p>
            <RouterLink to="/login">
              <VBtn block color="primary" prepend-icon="tabler-login">
                {{ t('auth.loginNow') }}
              </VBtn>
            </RouterLink>
          </VCardText>
        </template>

        <!-- ───── Form state ───── -->
        <template v-else>
          <VCardText class="text-center pb-2">
            <h4 class="text-h4 mb-1">
              {{ t('auth.resetTitle') }}
            </h4>
            <p class="mb-0 text-medium-emphasis">
              {{ t('auth.resetSubtitle') }}
            </p>
          </VCardText>

          <VCardText>
            <VAlert v-if="isError" color="error" variant="tonal" density="compact" class="mb-4">
              {{ errorMessage }}
            </VAlert>

            <VForm ref="refVForm" @submit.prevent="onSubmit">
              <VRow>
                <VCol cols="12">
                  <AppTextField
                    v-model="newPassword"
                    :label="t('auth.newPassword')"
                    :placeholder="t('auth.newPasswordPh')"
                    :type="isNewPasswordVisible ? 'text' : 'password'"
                    :append-inner-icon="isNewPasswordVisible ? 'tabler-eye-off' : 'tabler-eye'"
                    @click:append-inner="isNewPasswordVisible = !isNewPasswordVisible"
                    :rules="[requiredValidator, passwordValidator]"
                    autocomplete="new-password"
                  />
                </VCol>

                <VCol cols="12">
                  <AppTextField
                    v-model="confirmPassword"
                    :label="t('auth.confirmPassword')"
                    :placeholder="t('auth.confirmPasswordPh')"
                    :type="isConfirmPasswordVisible ? 'text' : 'password'"
                    :append-inner-icon="isConfirmPasswordVisible ? 'tabler-eye-off' : 'tabler-eye'"
                    @click:append-inner="isConfirmPasswordVisible = !isConfirmPasswordVisible"
                    :rules="confirmPasswordRules"
                    autocomplete="new-password"
                  />
                </VCol>

                <VCol cols="12">
                  <VBtn
                    block
                    type="submit"
                    :loading="isLoading"
                    :disabled="isLoading"
                  >
                    {{ isLoading ? t('auth.resetSaving') : t('auth.resetBtn') }}
                  </VBtn>
                </VCol>

                <VCol cols="12" class="text-center pt-0">
                  <RouterLink to="/login" class="back-link">
                    <VIcon icon="tabler-arrow-left" size="14" class="me-1" />
                    {{ t('auth.backToLogin') }}
                  </RouterLink>
                </VCol>
              </VRow>
            </VForm>
          </VCardText>
        </template>
      </VCard>
    </div>
  </div>
</template>

<style lang="scss">
@use "@core/scss/template/pages/page-auth";

.app-logo {
  display: inline-flex;
  justify-content: center;
  align-items: center;

  svg,
  img {
    width: 80px;
    height: 80px;
  }
}

.back-link {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--bm-navy);
  text-decoration: none;
  opacity: 0.8;
  transition: opacity 0.15s;
  display: inline-flex;
  align-items: center;

  &:hover {
    opacity: 1;
    text-decoration: underline;
  }
}
</style>
