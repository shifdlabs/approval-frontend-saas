<script setup lang="ts">
import { useGenerateImageVariant } from '@core/composable/useGenerateImageVariant'
import misc401 from '@images/pages/401.png'
import miscMaskDark from '@images/pages/misc-mask-dark.png'
import miscMaskLight from '@images/pages/misc-mask-light.png'

const authThemeMask = useGenerateImageVariant(miscMaskLight, miscMaskDark)

definePage({
  meta: {
    layout: 'blank',
    public: true,
  },
})

const route = useRoute()

const reason = computed(() => String(route.query.reason || ''))

const title = computed(() => {
  if (reason.value === 'subscription_inactive')
    return 'Subscription Tidak Aktif'
  if (reason.value === 'org_missing')
    return 'Akun Tidak Terhubung ke Organisasi'

  return 'Akses Ditolak'
})

const description = computed(() => {
  if (reason.value === 'subscription_inactive')
    return 'Akun Anda belum memiliki subscription aktif untuk Shifd Approval. Silakan hubungi administrator organisasi Anda.'
  if (reason.value === 'org_missing')
    return 'Sesi login Anda tidak terhubung ke organisasi mana pun. Silakan login ulang atau hubungi administrator.'

  return 'Anda tidak memiliki akses untuk melihat halaman ini.'
})
</script>

<template>
  <div class="misc-wrapper">
    <ErrorHeader
      status-code="403"
      :title="title"
      :description="description"
    />

    <VBtn href="/" class="mb-11">
      Kembali ke Login
    </VBtn>

    <div class="misc-avatar w-100 text-center">
      <VImg
        :src="misc401"
        alt="access restricted"
        :max-height="$vuetify.display.smAndDown ? 350 : 500"
        class="mx-auto"
      />
    </div>

    <img
      class="misc-footer-img d-none d-md-block"
      :src="authThemeMask"
      alt="misc-footer-img"
      height="320"
    >
  </div>
</template>

<style lang="scss">
@use "@core/scss/template/pages/misc.scss";
</style>
