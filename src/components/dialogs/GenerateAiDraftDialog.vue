<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { VForm } from 'vuetify/components'

interface Props {
  isDialogVisible: boolean
  // True when the body editor already has content, so the user is warned that
  // generating will replace what they wrote.
  hasExistingBody?: boolean
}

interface Emit {
  (e: 'update:isDialogVisible', val: boolean): void
  // Emitted with the generated letter body as plain text; the page decides how
  // to place it into the editor.
  (e: 'draftGenerated', draft: string): void
}

const emit = defineEmits<Emit>()
const props = defineProps<Props>()

const { t } = useI18n()

const initialFormData = {
  letterType: '',
  purpose: '',
  keyPoints: '',
  recipient: '',
  tone: 'formal',
}

const formData = ref({ ...initialFormData })
const refVForm = ref<VForm>()
const isAllInputtedValid = ref(true)
const isGenerating = ref(false)
const errorMessage = ref('')

watch(
  () => props.isDialogVisible,
  (isVisible) => {
    if (isVisible) {
      formData.value = { ...initialFormData }
      isAllInputtedValid.value = true
      errorMessage.value = ''
    }
  },
)

const toneOptions = computed(() => [
  { title: t('aiDraft.toneFormal'), value: 'formal' },
  { title: t('aiDraft.toneSemiFormal'), value: 'semi-formal' },
])

// Key points are entered one per line — far simpler than an add/remove row
// editor, and it maps straight onto the array the API expects.
const keyPointsList = computed(() =>
  formData.value.keyPoints
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0),
)

// Mirrors the backend's own limits (min 1, max 20 points, 500 chars each) so an
// invalid request is caught before it costs a round trip.
const keyPointsValidator = (value: string) => {
  const points = (value || '').split('\n').map(l => l.trim()).filter(Boolean)

  if (points.length === 0)
    return t('aiDraft.keyPointsRequired')
  if (points.length > 20)
    return t('aiDraft.keyPointsTooMany')
  if (points.some(p => p.length > 500))
    return t('aiDraft.keyPointsTooLong')

  return true
}

const generateDraft = async () => {
  isGenerating.value = true
  errorMessage.value = ''

  try {
    const { data, response } = await useApi('/ai/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        letter_type: formData.value.letterType,
        purpose: formData.value.purpose,
        key_points: keyPointsList.value,
        recipient: formData.value.recipient || undefined,
        tone: formData.value.tone,
      }),
    }).json<{ success: boolean, data: { draft: string, tokens_used: number } }>()

    if (data.value?.success && data.value.data?.draft) {
      emit('draftGenerated', data.value.data.draft)
      emit('update:isDialogVisible', false)
      return
    }

    // Keep the dialog open on failure so the user does not lose what they typed.
    errorMessage.value = messageForStatus(response.value?.status)
  }
  catch (e) {
    console.error('AI draft generation failed:', e)
    errorMessage.value = t('aiDraft.errorGeneric')
  }
  finally {
    isGenerating.value = false
  }
}

// The backend distinguishes quota, feature-disabled and provider failure —
// each needs a different action from the user, so they get different messages.
const messageForStatus = (status?: number) => {
  if (status === 429)
    return t('aiDraft.errorQuota')
  if (status === 503)
    return t('aiDraft.errorDisabled')
  if (status === 502)
    return t('aiDraft.errorProvider')

  return t('aiDraft.errorGeneric')
}

const onFormSubmit = async () => {
  refVForm.value?.validate()
    .then(({ valid: isValid }) => {
      if (isValid) {
        isAllInputtedValid.value = true
        generateDraft()
      }
      else {
        isAllInputtedValid.value = false
      }
    })
}

const onFormReset = () => {
  emit('update:isDialogVisible', false)
}

const dialogModelValueUpdate = (val: boolean) => {
  // Ignore outside clicks while a generation is in flight — closing mid-request
  // would discard a draft the org has already paid for.
  if (isGenerating.value)
    return

  emit('update:isDialogVisible', val)
}
</script>

<template>
  <VDialog
    :width="$vuetify.display.smAndDown ? 'auto' : 620"
    :model-value="props.isDialogVisible"
    :persistent="isGenerating"
    @update:model-value="dialogModelValueUpdate"
  >
    <VCard class="bm-dialog">
      <div class="bmd-head">
        <div class="bmd-mark">
          <VIcon icon="tabler-sparkles" size="22" />
        </div>
        <div class="bmd-titles">
          <h2>{{ t('aiDraft.title') }}</h2>
          <p>{{ t('aiDraft.subtitle') }}</p>
        </div>
        <button
          class="bmd-close"
          type="button"
          :disabled="isGenerating"
          @click="dialogModelValueUpdate(false)"
        >
          <VIcon icon="tabler-x" size="18" />
        </button>
      </div>

      <VForm ref="refVForm" @submit.prevent="onFormSubmit">
        <div class="bmd-body">
          <VAlert v-if="errorMessage" color="error" class="mb-3">
            {{ errorMessage }}
          </VAlert>
          <VAlert v-if="!isAllInputtedValid" color="error" class="mb-3">
            {{ t('common.errorFormInput') }}
          </VAlert>
          <VAlert v-if="props.hasExistingBody" color="warning" variant="tonal" class="mb-3">
            {{ t('aiDraft.overwriteWarning') }}
          </VAlert>

          <VRow>
            <VCol cols="12" md="6">
              <AppTextField
                v-model="formData.letterType"
                :label="t('aiDraft.letterType')"
                :placeholder="t('aiDraft.letterTypePh')"
                :disabled="isGenerating"
                :rules="[requiredValidator, maxLengthValidator(100)]"
              />
            </VCol>
            <VCol cols="12" md="6">
              <AppSelect
                v-model="formData.tone"
                :label="t('aiDraft.tone')"
                :items="toneOptions"
                :disabled="isGenerating"
                :rules="[requiredValidator]"
              />
            </VCol>

            <VCol cols="12">
              <AppTextarea
                v-model="formData.purpose"
                :label="t('aiDraft.purpose')"
                :placeholder="t('aiDraft.purposePh')"
                rows="2"
                :disabled="isGenerating"
                :rules="[requiredValidator, maxLengthValidator(1000)]"
              />
            </VCol>

            <VCol cols="12">
              <AppTextarea
                v-model="formData.keyPoints"
                :label="t('aiDraft.keyPoints')"
                :placeholder="t('aiDraft.keyPointsPh')"
                rows="4"
                :disabled="isGenerating"
                :rules="[keyPointsValidator]"
                :hint="t('aiDraft.keyPointsHint')"
                persistent-hint
              />
            </VCol>

            <VCol cols="12">
              <AppTextField
                v-model="formData.recipient"
                :label="t('aiDraft.recipient')"
                :placeholder="t('aiDraft.recipientPh')"
                :disabled="isGenerating"
                :rules="[maxLengthValidator(255)]"
              />
            </VCol>
          </VRow>

          <div class="text-caption text-medium-emphasis mt-3">
            {{ t('aiDraft.reviewNotice') }}
          </div>
        </div>

        <div class="bmd-foot">
          <button
            class="bmd-btn bmd-btn-ghost"
            type="button"
            :disabled="isGenerating"
            @click="onFormReset"
          >
            {{ t('aiDraft.cancel') }}
          </button>
          <button class="bmd-btn bmd-btn-primary" type="submit" :disabled="isGenerating">
            <VProgressCircular v-if="isGenerating" indeterminate size="16" width="2" class="me-2" />
            {{ isGenerating ? t('aiDraft.generating') : t('aiDraft.generate') }}
          </button>
        </div>
      </VForm>
    </VCard>
  </VDialog>
</template>
