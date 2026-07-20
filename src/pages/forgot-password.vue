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
const refVForm = ref<VForm>()
const email = ref('')
const isLoading = ref(false)
const isSent = ref(false)
const isError = ref(false)
const errorMessage = ref('')

const onSubmit = () => {
  refVForm.value?.validate().then(async ({ valid }) => {
    if (!valid) return

    isLoading.value = true
    isError.value = false

    try {
      // SIS owns password recovery. It responds identically whether or not the
      // email exists (enumeration-safe), so a 2xx here just means "handled".
      await sisApi('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: email.value },
      })
      isSent.value = true
    } catch (e) {
      isError.value = true
      const { code } = parseSisError(e)
      if (code === 'RATE_LIMIT_EXCEEDED') {
        errorMessage.value = t('auth.error429')
      } else {
        errorMessage.value = t('auth.forgotError')
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

        <!-- ───── Success state ───── -->
        <template v-if="isSent">
          <VCardText class="text-center pt-2 pb-6 px-6">
            <div class="success-mark mb-5">
              <VIcon icon="tabler-circle-check" size="52" color="success" />
            </div>
            <h4 class="text-h5 font-weight-bold mb-2">
              {{ t('auth.forgotSuccessTitle') }}
            </h4>
            <p class="text-body-1 text-medium-emphasis mb-6">
              {{ t('auth.forgotSuccessMsg') }}
            </p>
            <RouterLink to="/login">
              <VBtn block variant="tonal" color="primary" prepend-icon="tabler-arrow-left">
                {{ t('auth.backToLogin') }}
              </VBtn>
            </RouterLink>
          </VCardText>
        </template>

        <!-- ───── Form state ───── -->
        <template v-else>
          <VCardText class="text-center pb-2">
            <h4 class="text-h4 mb-1">
              {{ t('auth.forgotTitle') }}
            </h4>
            <p class="mb-0 text-medium-emphasis">
              {{ t('auth.forgotSubtitle') }}
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
                    v-model="email"
                    :label="t('auth.email')"
                    type="email"
                    :placeholder="t('auth.emailPh')"
                    prepend-inner-icon="tabler-mail"
                    :rules="[requiredValidator, emailValidator]"
                  />
                </VCol>

                <VCol cols="12">
                  <VBtn
                    block
                    type="submit"
                    :loading="isLoading"
                    :disabled="isLoading"
                  >
                    {{ isLoading ? t('auth.forgotSending') : t('auth.forgotBtn') }}
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

.success-mark {
  display: flex;
  justify-content: center;
}
</style>
