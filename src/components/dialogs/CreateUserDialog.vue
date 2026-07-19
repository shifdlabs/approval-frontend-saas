<script setup lang="ts">
import { User } from '@/models/users/users';
import { ref, watch } from 'vue';
import { VForm } from 'vuetify/components';

interface Props {
  userList: User[];
  isDialogVisible: boolean;
  isRefetchList: boolean;
}

interface Emit {
  (e: 'update:userList', value: User[]): void;
  (e: 'update:isDialogVisible', val: boolean): void;
  (e: 'update:isRefetchList', val: boolean): void;
}

const emit = defineEmits<Emit>();
const props = defineProps<Props>();

const initialFormData = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
};

const formData = ref({ ...initialFormData });

watch(
  () => props.isDialogVisible,
  (isVisible) => {
    if (isVisible) {
      formData.value = { ...initialFormData };
      isAllInputtedValid.value = true;
      errorMessage.value = '';
    }
  }
);

const isPasswordVisible = ref(false);
const isConfirmPasswordVisible = ref(false);
const refVForm = ref<VForm>();
const isAllInputtedValid = ref(true);
const errorMessage = ref('');
const isSuccessSnackbarVisible = ref(false);
const successMessage = ref('');

// Approval no longer creates user accounts directly — SIS owns identity
// (Phase 2). Adding a member is two SIS calls: register the global account,
// then attach it to this org. The local Approval `users` row is created
// automatically on that person's first login (see
// config/middleware/jwks_middleware.go ensureUserProvisioned) — there is
// nothing left for Approval's own API to do here.
const createNewUser = async () => {
  errorMessage.value = ''

  // Step 1 — register the global SIS identity.
  try {
    await sisApi('/api/auth/register', {
      method: 'POST',
      body: {
        name: formData.value.name,
        email: formData.value.email,
        password: formData.value.password,
      },
    })
  } catch (e) {
    const sisErr = parseSisError(e)
    if (sisErr.code === 'EMAIL_ALREADY_EXISTS') {
      errorMessage.value = 'Email ini sudah terdaftar di SIS. Gunakan fitur Invite Member untuk menambahkan mereka ke organisasi ini.'
    } else {
      errorMessage.value = sisErr.message
    }
    return // do not proceed to Step 2
  }

  // Step 2 — add the newly-registered identity as a member of this org.
  const orgId = getCurrentOrgId()
  try {
    await sisApi(`/api/orgs/${orgId}/members`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${useCookie('accessToken').value}`,
      },
      body: {
        email: formData.value.email,
        role: 'member',
      },
    })
  } catch (e) {
    errorMessage.value = parseSisError(e).message
    return
  }

  successMessage.value = `User ${formData.value.name} berhasil ditambahkan. Mereka dapat login menggunakan email dan password yang telah dibuat.`
  isSuccessSnackbarVisible.value = true
  emit('update:isDialogVisible', false)
  emit('update:isRefetchList', true)
}

const onFormSubmit = async () => {
  refVForm.value?.validate().then(({ valid: isValid }) => {
    if (isValid) {
      isAllInputtedValid.value = true;
      errorMessage.value = '';
      createNewUser();
    } else {
      isAllInputtedValid.value = false;
    }
  });
};

const onFormReset = () => {
  emit('update:isDialogVisible', false);
};

const dialogModelValueUpdate = (val: boolean) => {
  emit('update:isDialogVisible', val);
};

const { t } = useI18n()
</script>

<template>
  <VDialog
    :width="$vuetify.display.smAndDown ? 'auto' : 620"
    :model-value="props.isDialogVisible"
    @update:model-value="dialogModelValueUpdate"
  >
    <VCard class="bm-dialog">
      <div class="bmd-head">
        <div class="bmd-mark">
          <VIcon icon="tabler-user-plus" size="22" />
        </div>
        <div class="bmd-titles">
          <h2>{{ t('users.create.title') }}</h2>
          <p>{{ t('users.create.subtitle') }}</p>
        </div>
        <button class="bmd-close" type="button" @click="dialogModelValueUpdate(false)">
          <VIcon icon="tabler-x" size="18" />
        </button>
      </div>

      <VForm ref="refVForm" @submit.prevent="onFormSubmit">
        <div class="bmd-body">
          <VAlert v-if="!isAllInputtedValid" color="error" class="mb-2">
            {{ t('common.errorFormInput') }}
          </VAlert>
          <VAlert v-if="errorMessage" color="error" class="mb-2">
            {{ errorMessage }}
          </VAlert>

          <VRow>
            <VCol cols="12">
              <AppTextField
                v-model="formData.name"
                :label="t('common.name')"
                :placeholder="t('common.namePh')"
                :rules="[requiredValidator, maxLengthValidator(100)]"
              />
            </VCol>
            <VCol cols="12">
              <AppTextField
                v-model="formData.email"
                :label="t('common.email')"
                type="email"
                :placeholder="t('common.emailPh')"
                :rules="[requiredValidator, emailValidator]"
              />
            </VCol>
            <VCol cols="12" md="6">
              <AppTextField
                v-model="formData.password"
                :label="t('common.password')"
                autocomplete="password"
                placeholder="············"
                :type="isPasswordVisible ? 'text' : 'password'"
                :append-inner-icon="isPasswordVisible ? 'tabler-eye-off' : 'tabler-eye'"
                @click:append-inner="isPasswordVisible = !isPasswordVisible"
                :rules="[requiredValidator, passwordValidator]"
              />
            </VCol>
            <VCol cols="12" md="6">
              <AppTextField
                v-model="formData.confirmPassword"
                :label="t('common.confirmPassword')"
                placeholder="············"
                :type="isConfirmPasswordVisible ? 'text' : 'password'"
                autocomplete="password"
                :append-inner-icon="isConfirmPasswordVisible ? 'tabler-eye-off' : 'tabler-eye'"
                :rules="[requiredValidator, confirmedValidator(formData.confirmPassword, formData.password)]"
                @click:append-inner="isConfirmPasswordVisible = !isConfirmPasswordVisible"
              />
            </VCol>
          </VRow>
        </div>

        <div class="bmd-foot">
          <button class="bmd-btn bmd-btn-ghost" type="button" @click="onFormReset">
            {{ t('common.cancel') }}
          </button>
          <button class="bmd-btn bmd-btn-primary" type="submit">
            {{ t('common.register') }}
          </button>
        </div>
      </VForm>
    </VCard>
  </VDialog>

  <VSnackbar
    v-model="isSuccessSnackbarVisible"
    multi-line
    :timeout="4000"
  >
    {{ successMessage }}

    <template #actions>
      <VBtn color="success" @click="isSuccessSnackbarVisible = false">
        {{ t('common.close') }}
      </VBtn>
    </template>
  </VSnackbar>
</template>
