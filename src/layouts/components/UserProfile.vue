<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

const handleLogout = async () => {
  const refreshToken = useCookie('refreshToken').value

  // Best-effort: revoke the refresh token on SIS. Logout is public there —
  // the refresh_token itself is the credential — and idempotent, so we don't
  // need to block local logout on its result.
  if (refreshToken) {
    try {
      await sisApi('/api/auth/logout', {
        method: 'POST',
        body: { refresh_token: refreshToken },
      })
    } catch (err) {
      console.error('SIS logout call failed (continuing with local logout):', err)
    }
  }

  // Hapus token dan informasi pengguna dari cookie
  useCookie('accessToken').value = null;
  useCookie('refreshToken').value = null;
  useCookie('name').value = null;
  useCookie('role').value = null;
  useCookie('jobPosition').value = null;
  useCookie('userId').value = null;

  window.location.href = '/'
};

const name = useCookie('name')
const jobPosition = useCookie('jobPosition')

const getInitials = computed(() => {
  const fullName = name.value || ''
  const parts = fullName.trim().split(' ')
  console.log(fullName)

  const first = parts[0]?.[0] || ''
  const second = parts[1]?.[0] || parts[0]?.[1] || ''

  return (first + second).toUpperCase()
})
</script>

<template>
  <VBadge
    dot
    location="bottom right"
    offset-x="3"
    offset-y="3"
    bordered
    color="success"
  >
    <VAvatar
      class="cursor-pointer"
      color="primary"
      variant="tonal"
    >
      {{ getInitials }}

      <!-- SECTION Menu -->
      <VMenu
        activator="parent"
        width="230"
        location="bottom end"
        offset="14px"
      >
        <VList>
          <!-- 👉 User Avatar & Name -->
          <VListItem>
            <template #prepend>
              <VListItemAction start>
                <VBadge
                  dot
                  location="bottom right"
                  offset-x="3"
                  offset-y="3"
                  color="success"
                >
                  <VAvatar
                    color="primary"
                    variant="tonal"
                  >
                    {{ getInitials }}
                  </VAvatar>
                </VBadge>
              </VListItemAction>
            </template>

            <VListItemTitle class="font-weight-semibold">
              {{ name }}
            </VListItemTitle>
            <VListItemSubtitle>{{ jobPosition }}</VListItemSubtitle>
          </VListItem>

          <VDivider class="my-2" />

          <!-- 👉 Profile -->
          <VListItem link :to="{ name: 'profile' }">
            <template #prepend>
              <VIcon
                class="me-2"
                icon="tabler-user"
                size="22"
              />
            </template>

            <VListItemTitle>Profile</VListItemTitle>
          </VListItem>

          <!-- 👉 Settings -->
          <!-- <VListItem link>
            <template #prepend>
              <VIcon
                class="me-2"
                icon="tabler-settings"
                size="22"
              />
            </template>

            <VListItemTitle>Settings</VListItemTitle>
          </VListItem> -->

          <!-- Divider -->
          <VDivider class="my-2" />

          <!-- 👉 Logout -->
          <VListItem @click="handleLogout">
            <template #prepend>
              <VIcon
                class="me-2"
                icon="tabler-logout"
                size="22"
              />
            </template>

            <VListItemTitle>Logout</VListItemTitle>
          </VListItem>
        </VList>
      </VMenu>
      <!-- !SECTION -->
    </VAvatar>
  </VBadge>
</template>
