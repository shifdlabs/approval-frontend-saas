<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { VForm } from 'vuetify/components'

interface Props {
  isDialogVisible: boolean
  // True when the body editor already has content, so the user is warned that
  // applying a draft will replace what they wrote.
  hasExistingBody?: boolean
}

interface Emit {
  (e: 'update:isDialogVisible', val: boolean): void
  // Emitted with the chosen letter body as plain text, only once the user has
  // picked a style and confirmed — the page decides how to place it into the
  // editor (see applyAiDraft in document/create.vue) and plays the apply effect.
  (e: 'draftGenerated', draft: string): void
}

const emit = defineEmits<Emit>()
const props = defineProps<Props>()

const { t } = useI18n()

interface DraftVariant {
  style: string
  draft: string
  tokensUsed: number
}

// Two-step flow: fill the brief, then compare styles before committing one to
// the editor. Splitting these avoids overwriting the user's letter body with
// something they have not actually reviewed yet.
const step = ref<'form' | 'variants'>('form')

const initialFormData = {
  letterType: '',
  purpose: '',
  keyPoints: '',
  recipient: '',
}

const formData = ref({ ...initialFormData })
const refVForm = ref<VForm>()
const isAllInputtedValid = ref(true)
const isGenerating = ref(false)
const errorMessage = ref('')
const variants = ref<DraftVariant[]>([])
const selectedStyle = ref<string | null>(null)

watch(
  () => props.isDialogVisible,
  (isVisible) => {
    if (isVisible) {
      step.value = 'form'
      formData.value = { ...initialFormData }
      isAllInputtedValid.value = true
      errorMessage.value = ''
      variants.value = []
      selectedStyle.value = null
    }
  },
)

// Fixed, stable order matching the backend's draftStyles — the backend only
// returns a `style` key per variant, this dialog owns the label/description.
const styleMeta: Record<string, { label: string, description: string }> = {
  formal: { label: t('aiDraft.styleFormalLabel'), description: t('aiDraft.styleFormalDesc') },
  ringkas: { label: t('aiDraft.styleRingkasLabel'), description: t('aiDraft.styleRingkasDesc') },
  'semi-formal': { label: t('aiDraft.styleSemiFormalLabel'), description: t('aiDraft.styleSemiFormalDesc') },
}

const selectedVariant = computed(() =>
  variants.value.find(v => v.style === selectedStyle.value) ?? null,
)

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
      }),
    }).json<{ success: boolean, data: { variants: { style: string, draft: string, tokens_used: number }[] } }>()

    const received = data.value?.data?.variants ?? []
    if (data.value?.success && received.length > 0) {
      variants.value = received.map(v => ({ style: v.style, draft: v.draft, tokensUsed: v.tokens_used }))
      selectedStyle.value = null
      step.value = 'variants'
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

// Back to the form with the brief kept intact, so the user can tweak and
// regenerate instead of retyping everything.
const backToForm = () => {
  step.value = 'form'
  errorMessage.value = ''
}

const confirmApply = () => {
  if (!selectedVariant.value)
    return

  emit('draftGenerated', selectedVariant.value.draft)
  emit('update:isDialogVisible', false)
}

const onFormReset = () => {
  emit('update:isDialogVisible', false)
}

const dialogModelValueUpdate = (val: boolean) => {
  // Ignore outside clicks while a generation is in flight — closing mid-request
  // would discard drafts the org has already paid for.
  if (isGenerating.value)
    return

  emit('update:isDialogVisible', val)
}
</script>

<template>
  <VDialog
    :width="$vuetify.display.smAndDown ? 'auto' : (step === 'variants' ? 760 : 620)"
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
          <h2>{{ step === 'form' ? t('aiDraft.title') : t('aiDraft.variantsTitle') }}</h2>
          <p>{{ step === 'form' ? t('aiDraft.subtitle') : t('aiDraft.variantsSubtitle') }}</p>
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

      <!-- Step 1: brief form -->
      <VForm v-if="step === 'form'" ref="refVForm" @submit.prevent="onFormSubmit">
        <div class="bmd-body">
          <VAlert v-if="errorMessage" color="error" class="mb-3">
            {{ errorMessage }}
          </VAlert>
          <VAlert v-if="!isAllInputtedValid" color="error" class="mb-3">
            {{ t('common.errorFormInput') }}
          </VAlert>

          <VRow>
            <VCol cols="12">
              <AppTextField
                v-model="formData.letterType"
                :label="t('aiDraft.letterType')"
                :placeholder="t('aiDraft.letterTypePh')"
                :disabled="isGenerating"
                :rules="[requiredValidator, maxLengthValidator(100)]"
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
            {{ t('aiDraft.stylesNotice') }}
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

      <!-- Step 2: pick a style -->
      <div v-else class="bmd-body">
        <VAlert v-if="variants.length < 3" color="info" variant="tonal" class="mb-3" density="compact">
          {{ t('aiDraft.partialVariantsNotice').replace('{count}', String(variants.length)) }}
        </VAlert>
        <VAlert v-if="props.hasExistingBody" color="warning" variant="tonal" class="mb-3" density="compact">
          {{ t('aiDraft.overwriteWarning') }}
        </VAlert>

        <div class="ai-variant-list">
          <VCard
            v-for="variant in variants"
            :key="variant.style"
            :variant="selectedStyle === variant.style ? 'tonal' : 'outlined'"
            :color="selectedStyle === variant.style ? 'primary' : undefined"
            class="ai-variant-card"
            @click="selectedStyle = variant.style"
          >
            <VCardText>
              <div class="d-flex align-center justify-space-between gap-2 mb-1">
                <div>
                  <div class="text-subtitle-2 font-weight-bold">
                    {{ styleMeta[variant.style]?.label ?? variant.style }}
                  </div>
                  <div class="text-caption text-medium-emphasis">
                    {{ styleMeta[variant.style]?.description }}
                  </div>
                </div>
                <VIcon
                  :icon="selectedStyle === variant.style ? 'tabler-circle-check-filled' : 'tabler-circle'"
                  :color="selectedStyle === variant.style ? 'primary' : 'secondary'"
                  size="22"
                />
              </div>
              <div class="ai-variant-preview">
                {{ variant.draft }}
              </div>
            </VCardText>
          </VCard>
        </div>

        <div class="text-caption text-medium-emphasis mt-3">
          {{ t('aiDraft.reviewNotice') }}
        </div>

        <div class="bmd-foot">
          <button class="bmd-btn bmd-btn-ghost" type="button" @click="backToForm">
            {{ t('aiDraft.regenerate') }}
          </button>
          <button
            class="bmd-btn bmd-btn-primary"
            type="button"
            :disabled="!selectedVariant"
            @click="confirmApply"
          >
            {{ t('aiDraft.apply') }}
          </button>
        </div>
      </div>
    </VCard>
  </VDialog>
</template>

<style scoped>
.ai-variant-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 55vh;
  overflow-y: auto;
}

.ai-variant-card {
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.ai-variant-preview {
  block-size: 140px;
  overflow-y: auto;
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.5;
  color: rgb(var(--v-theme-on-surface), 0.8);
  padding-block-start: 8px;
  border-block-start: 1px dashed rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
