<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import * as XLSX from 'xlsx';
import { Workbook } from 'exceljs';

interface Props {
  isDialogVisible: boolean;
  isRefetchList: boolean;
  positions: any[];
}

interface Emit {
  (e: 'update:isDialogVisible', val: boolean): void;
  (e: 'update:isRefetchList', val: boolean): void;
}

const emit = defineEmits<Emit>();
const props = defineProps<Props>();

// Step tracking
const currentStep = ref(1);
const totalSteps = 3;

// File upload
const selectedFile = ref<File | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

// Column mapping — `firstName` is kept as the internal/wire key (Approval
// Backend's /user/import/preview parses columnMapping["firstName"]) even
// though the UI now labels it "Nama Column" and treats it as the single
// full-name field sent to SIS register as `name`.
const excelColumns = ref<string[]>([]);
const columnMapping = ref({
  email: '',
  firstName: '',
  role: '',
  password: '',
});

// Preview data
const previewData = ref<any[]>([]);
const previewErrors = ref<any[]>([]);
const previewWarnings = ref<any[]>([]);
const isLoadingPreview = ref(false);

// Bulk import — each row is processed as two sequential SIS calls (register
// the identity, then add it to this org). Approval Backend's own bulk-create
// endpoint (POST /user/import/bulk) is no longer called: it created
// local-only accounts that don't exist in SIS and can't log in. The local
// Approval `users` row for each member is created automatically on their
// first login (see config/middleware/jwks_middleware.go
// ensureUserProvisioned) — there is nothing left for Approval's own API to
// do here.
interface RowResult {
  index: number;
  email: string;
  status: 'SUCCESS_NEW' | 'SUCCESS_EXISTING' | 'FAILED' | 'SKIPPED';
  reason?: string;
}

const isImporting = ref(false);
const importStarted = ref(false);
const currentProcessingIndex = ref(0);
const rowResults = ref<RowResult[]>([]);
const customPassword = ref('');
const showPassword = ref(false);

const importSummary = computed(() => ({
  successNew: rowResults.value.filter(r => r.status === 'SUCCESS_NEW').length,
  successExisting: rowResults.value.filter(r => r.status === 'SUCCESS_EXISTING').length,
  failed: rowResults.value.filter(r => r.status === 'FAILED'),
  skipped: rowResults.value.filter(r => r.status === 'SKIPPED'),
}));

const previewHeaders = [
  { title: 'Nama', key: 'firstName' },
  { title: 'Email', key: 'email' },
  { title: 'Role', key: 'role' },
];


watch(
  () => props.isDialogVisible,
  (isVisible) => {
    if (isVisible) {
      resetDialog();
    }
  }
);

const resetDialog = () => {
  currentStep.value = 1;
  selectedFile.value = null;
  excelColumns.value = [];
  columnMapping.value = {
    email: '',
    firstName: '',
    role: '',
    password: '',
  };
  previewData.value = [];
  previewErrors.value = [];
  previewWarnings.value = [];
  importStarted.value = false;
  currentProcessingIndex.value = 0;
  rowResults.value = [];
  customPassword.value = '';
  showPassword.value = false;
};

const onFileSelected = (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    const file = input.files[0];
    if (file.size > 10 * 1024 * 1024) {
      alert('File size must not exceed 10MB. Please upload a smaller file.');
      input.value = '';
      return;
    }
    selectedFile.value = file;
    parseExcelHeaders();
  }
};

const parseExcelHeaders = async () => {
  if (!selectedFile.value) return;

  try {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const data = e.target?.result;
      if (!data) return;

      const workbook = XLSX.read(data, { type: 'binary' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Get range of the worksheet
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      
      // Extract headers from first row
      const headers: string[] = [];
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
        const cell = worksheet[cellAddress];
        if (cell && cell.v) {
          headers.push(String(cell.v));
        }
      }
      
      excelColumns.value = headers;
      currentStep.value = 2;
    };
    
    reader.onerror = (error) => {
      console.error('Error reading file:', error);
      alert('Failed to read Excel file');
    };
    
    reader.readAsBinaryString(selectedFile.value);
  } catch (error) {
    console.error('Error parsing Excel:', error);
    alert('Failed to parse Excel file');
  }
};

const goToNextStep = () => {
  if (currentStep.value < totalSteps) {
    if (currentStep.value === 2) {
      // Validate column mapping and load preview
      loadPreview();
    } else {
      currentStep.value++;
    }
  }
};

const goToPreviousStep = () => {
  if (currentStep.value > 1) {
    // Clear preview data when going back from Step 3 to Step 2
    if (currentStep.value === 3) {
      previewData.value = [];
      previewErrors.value = [];
      previewWarnings.value = [];
    }
    currentStep.value--;
  }
};

const remapColumns = () => {
  // Clear preview data and go back to Step 2 for remapping
  previewData.value = [];
  previewErrors.value = [];
  previewWarnings.value = [];
  currentStep.value = 2;
};

const loadPreview = async () => {
  if (!selectedFile.value) return;

  isLoadingPreview.value = true;
  
  try {
    const formData = new FormData();
    formData.append('file', selectedFile.value);
    formData.append('columnMapping', JSON.stringify(columnMapping.value));

    const { data, error } = await useApi('/user/import/preview', {
      method: 'POST',
      body: formData,
    }).json<{ data: { users: any[], errors: any[], warnings: any[] } }>();

    if (data.value?.data) {
      previewData.value = data.value.data.users || [];
      previewErrors.value = data.value.data.errors || [];
      previewWarnings.value = data.value.data.warnings || [];
      
      // Validate email format using proper regex
      const emailRegex = /^(?:[^<>()[\]\\.,;:\s@"]+(?:\.[^<>()[\]\\.,;:\s@"]+)*|".+")@(?:\[\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\]|(?:[a-z\-\d]+\.)+[a-z]{2,})$/i;
      const invalidEmails = previewData.value.filter(user =>
        user.email && !emailRegex.test(String(user.email))
      );

      if (invalidEmails.length > 0) {
        alert(`Warning: ${invalidEmails.length} row(s) have invalid email format.\n\nPlease check your column mapping in Step 2!`);
        currentStep.value = 2;
        return;
      }
      
      // Only change step if not already at step 3 (e.g., when clicking Refresh Preview)
      if (currentStep.value !== 3) {
        currentStep.value = 3;
      }
    } else {
      console.error('Failed to load preview:', error.value);
      alert('Failed to load preview. Please check your file and column mapping.');
    }
  } catch (e) {
    console.error('Error loading preview:', e);
    alert('An error occurred while loading preview.');
  } finally {
    isLoadingPreview.value = false;
  }
};

// Template only needs what register/add-to-org actually consume (name,
// email, password, role). employeeID/position/access used to be columns
// here too, but those are now set after the user's first login
// (auto-provisioning middleware), not at import time — see importOneRow
// below. Uses exceljs (not the `xlsx` package used for reading uploads
// above) because only exceljs can write real cell styling — the gray
// italic example row needs that.
const downloadTemplate = async () => {
  const workbook = new Workbook();

  const dataSheet = workbook.addWorksheet('Data User');
  dataSheet.addRow(['Nama', 'Email', 'Password', 'Role (optional)']);
  const exampleRow = dataSheet.addRow(['(Nama lengkap)', '(Email aktif)', '(Min. 8 karakter)', '(admin / member)']);

  dataSheet.getRow(1).font = { bold: true };
  exampleRow.eachCell(cell => {
    cell.font = { italic: true, color: { argb: 'FF808080' } };
  });
  [24, 28, 20, 20].forEach((width, idx) => {
    dataSheet.getColumn(idx + 1).width = width;
  });

  const instructionSheet = workbook.addWorksheet('Petunjuk');
  instructionSheet.addRow(['Password minimal 8 karakter.']);
  instructionSheet.addRow(['Posisi dan ID karyawan dapat diatur setelah user login pertama kali.']);
  instructionSheet.addRow(['Role: isi admin atau member. Kosongkan untuk default member.']);
  instructionSheet.getColumn(1).width = 70;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Template_Import_User.xlsx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const generateSecurePassword = (): string => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%&*()';
  const pick = (chars: string) => chars[Math.floor(Math.random() * chars.length)];

  const required = [pick(upper), pick(lower), pick(digits), pick(special)];
  const rest = Array.from({ length: 8 }, () => pick(upper + lower + digits + special));

  return [...required, ...rest].sort(() => Math.random() - 0.5).join('');
};

// Role column accepts either the new text values ("admin"/"member") or the
// legacy numeric codes (99/1) some sheets still use. Anything else — empty,
// unrecognized, or just not mapped — defaults to "member".
const resolveSisRole = (rawRole: unknown): 'admin' | 'member' => {
  const value = String(rawRole ?? '').trim().toLowerCase();
  return value === 'admin' || value === '99' ? 'admin' : 'member';
};

// One row = one member: register the global SIS identity, then attach it to
// this org. If the identity already exists in SIS (e.g. invited before, or
// a member of another org), that's not a failure — skip straight to
// attaching it here.
const importOneRow = async (row: any): Promise<{ status: RowResult['status'], reason?: string }> => {
  const name = String(row.firstName ?? '').trim() || row.email;
  const password = row.password || customPassword.value || generateSecurePassword();

  let alreadyInSis = false;

  try {
    await sisApi('/api/auth/register', {
      method: 'POST',
      body: { name, email: row.email, password },
    });
  } catch (e) {
    const sisErr = parseSisError(e);
    if (sisErr.code === 'EMAIL_ALREADY_EXISTS') {
      alreadyInSis = true;
    } else {
      return { status: 'FAILED', reason: sisErr.message };
    }
  }

  const orgId = getCurrentOrgId();
  try {
    await sisApi(`/api/orgs/${orgId}/members`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${useCookie('accessToken').value}` },
      body: { email: row.email, role: resolveSisRole(row.role) },
    });
  } catch (e) {
    const sisErr = parseSisError(e);
    if (sisErr.code === 'USER_LIMIT_REACHED')
      return { status: 'SKIPPED', reason: 'Batas user tercapai' };
    return { status: 'FAILED', reason: sisErr.message };
  }

  return { status: alreadyInSis ? 'SUCCESS_EXISTING' : 'SUCCESS_NEW' };
};

const performImport = async () => {
  if (previewData.value.length === 0) return;

  if (customPassword.value) {
    const pwRegex = /(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[!@#$%&*()]).{8,}/;
    if (!pwRegex.test(customPassword.value)) {
      alert('Custom password must be at least 8 characters and contain uppercase, lowercase, a digit, and a special character (!@#$%&*()).');
      return;
    }
  }

  isImporting.value = true;
  importStarted.value = true;
  rowResults.value = [];
  currentProcessingIndex.value = 0;

  const rows = previewData.value;
  let limitReached = false;

  for (let i = 0; i < rows.length; i++) {
    currentProcessingIndex.value = i + 1;

    const result = await importOneRow(rows[i]);
    rowResults.value.push({ index: i + 1, email: rows[i].email, status: result.status, reason: result.reason });

    if (result.status === 'SKIPPED') {
      limitReached = true;
      break;
    }
  }

  if (limitReached) {
    for (let j = rowResults.value.length; j < rows.length; j++) {
      rowResults.value.push({ index: j + 1, email: rows[j].email, status: 'SKIPPED', reason: 'Batas user tercapai' });
    }
  }

  isImporting.value = false;

  if (importSummary.value.successNew + importSummary.value.successExisting > 0) {
    emit('update:isRefetchList', true);
  }
};

const closeAfterImport = () => {
  emit('update:isDialogVisible', false);
};

const canProceedToNextStep = computed(() => {
  if (currentStep.value === 1) {
    return selectedFile.value !== null;
  } else if (currentStep.value === 2) {
    // Nama, Email, and Password columns are required; Role is optional.
    return columnMapping.value.email !== '' && columnMapping.value.firstName !== '' && columnMapping.value.password !== '';
  }
  return false;
});

const getRoleText = (role: number) => (role === 99 ? 'Admin' : 'Member');
</script>

<template>
  <VDialog
    :model-value="props.isDialogVisible"
    max-width="1200"
    persistent
    @update:model-value="(val) => emit('update:isDialogVisible', val)"
  >
    <VCard class="bm-dialog imp-dialog">
      <div class="bmd-head">
        <div class="bmd-mark">
          <VIcon icon="tabler-file-upload" size="22" />
        </div>
        <div class="bmd-titles">
          <h2>Import Users from Excel</h2>
          <p>Upload an Excel file and map columns to user fields</p>
        </div>
        <button class="bmd-close" type="button" @click="emit('update:isDialogVisible', false)">
          <VIcon icon="tabler-x" size="18" />
        </button>
      </div>

      <div class="bmd-body imp-body">
        <!-- Stepper -->
        <VStepper v-model="currentStep" flat>
          <VStepperHeader>
            <VStepperItem :value="1" title="Upload Excel File" />
            <VDivider />
            <VStepperItem :value="2" title="Map Columns" />
            <VDivider />
            <VStepperItem :value="3" title="Preview & Import" />
          </VStepperHeader>

          <VStepperWindow>
          <!-- Step 1: Upload File -->
          <VStepperWindowItem :value="1">
            <div class="d-flex flex-wrap justify-space-between align-center gap-3 mb-4">
              <p class="text-body-1 ma-0">
                Upload an Excel file (.xlsx) containing user data.
              </p>
              <VBtn
                color="var(--bm-navy)"
                variant="tonal"
                size="small"
                prepend-icon="tabler-download"
                @click="downloadTemplate"
              >
                Download Template
              </VBtn>
            </div>

            <VFileInput
              ref="fileInputRef"
              v-model="selectedFile"
              label="Select Excel File"
              accept=".xlsx,.xls"
              prepend-icon="tabler-file-upload"
              @change="onFileSelected"
            />

            <VAlert v-if="selectedFile" type="success" variant="tonal" class="mt-4">
              File selected: {{ selectedFile.name }}
            </VAlert>
          </VStepperWindowItem>

          <!-- Step 2: Column Mapping -->
          <VStepperWindowItem :value="2">
            <VAlert color="var(--bm-navy)" variant="tonal" class="mb-4">
              Fields marked with * are required.
            </VAlert>

            <VRow>
              <VCol cols="12" md="6">
                <AppSelect
                  v-model="columnMapping.email"
                  label="Email Column *"
                  placeholder="Select column"
                  :items="excelColumns"
                  clearable
                />
              </VCol>

              <VCol cols="12" md="6">
                <AppSelect
                  v-model="columnMapping.firstName"
                  label="Nama Column *"
                  placeholder="Select column"
                  :items="excelColumns"
                  clearable
                />
              </VCol>

              <VCol cols="12" md="6">
                <AppSelect
                  v-model="columnMapping.password"
                  label="Password Column *"
                  placeholder="Select column"
                  :items="excelColumns"
                  clearable
                />
              </VCol>

              <VCol cols="12" md="6">
                <AppSelect
                  v-model="columnMapping.role"
                  label="Role Column (optional)"
                  placeholder="Select column"
                  hint="Nilai yang diterima: admin atau member. Kosongkan untuk default member."
                  persistent-hint
                  :items="excelColumns"
                  clearable
                />
              </VCol>
            </VRow>
          </VStepperWindowItem>

          <!-- Step 3: Preview -->
          <VStepperWindowItem :value="3">
            <div class="d-flex flex-wrap justify-space-between align-center gap-3 mb-4">
              <div>
                <p class="text-body-1 ma-0 mb-1">
                  Review the data before importing. Total users: {{ previewData.length }}
                </p>
                <p class="text-caption text-medium-emphasis ma-0">
                  Need to change column mapping? Click the button on the right
                </p>
              </div>
              <VBtn
                v-if="!importStarted"
                color="var(--bm-navy)"
                variant="tonal"
                size="small"
                prepend-icon="tabler-edit"
                @click="remapColumns"
              >
                Edit Mapping
              </VBtn>
            </div>

            <!-- Progress indicator while rows are processed sequentially
                 against SIS (register, then add-to-org, per row). -->
            <VAlert v-if="isImporting" color="var(--bm-navy)" variant="tonal" class="mb-4">
              <div class="mb-2">Memproses {{ currentProcessingIndex }} dari {{ previewData.length }} user...</div>
              <VProgressLinear
                :model-value="(currentProcessingIndex / previewData.length) * 100"
                color="var(--bm-navy)"
                height="8"
                rounded
              />
            </VAlert>

            <!-- Result summary, shown once sequential processing has
                 finished (success or not). -->
            <VAlert v-if="importStarted && !isImporting" type="info" variant="tonal" class="mb-4">
              <div class="text-h6 mb-2">Hasil Import</div>
              <ul class="mb-2">
                <li>{{ importSummary.successNew }} berhasil ditambahkan</li>
                <li>{{ importSummary.successExisting }} sudah terdaftar dan berhasil ditambahkan ke org</li>
                <li>{{ importSummary.failed.length }} gagal</li>
                <li>{{ importSummary.skipped.length }} dilewati karena batas user tercapai</li>
              </ul>

              <template v-if="importSummary.failed.length > 0">
                <div class="text-subtitle-2 mb-1">Detail gagal:</div>
                <ul class="mb-2">
                  <li v-for="row in importSummary.failed" :key="'failed-' + row.index">
                    Row {{ row.index }} ({{ row.email }}): {{ row.reason }}
                  </li>
                </ul>
              </template>

              <template v-if="importSummary.skipped.length > 0">
                <div class="text-subtitle-2 mb-1">Dilewati:</div>
                <ul>
                  <li v-for="row in importSummary.skipped" :key="'skipped-' + row.index">
                    Row {{ row.index }} ({{ row.email }}): {{ row.reason }}
                  </li>
                </ul>
              </template>
            </VAlert>

            <!-- Password Configuration Section -->
            <VDivider class="mb-4" />
            <div class="text-h6 mb-3 d-flex align-center">
              <VIcon icon="tabler-key" color="var(--bm-navy)" class="me-2" />
              Password Configuration
            </div>
            <VRow class="mb-4">
              <VCol cols="12" md="6">
                <AppTextField
                  v-model="customPassword"
                  :type="showPassword ? 'text' : 'password'"
                  label="Custom Password for All Users (Optional)"
                  placeholder="Leave empty to auto-generate a secure random password"
                  hint="Must be 8+ chars with uppercase, lowercase, digit, and special character (!@#$%&*())"
                  persistent-hint
                  :append-inner-icon="showPassword ? 'tabler-eye-off' : 'tabler-eye'"
                  @click:append-inner="showPassword = !showPassword"
                />
              </VCol>
            </VRow>
            <VDivider class="mb-4" />

            <VAlert color="var(--bm-navy)" variant="tonal" class="mb-4">
              <strong>Default Values:</strong> Fields not mapped will use defaults during import:
              <ul class="mt-2">
                <li>Role: Member (default if Role column is empty or unrecognized)</li>
                <li>Password: {{ customPassword ? 'Custom password set' : 'Auto-generated (secure random)' }}</li>
              </ul>
            </VAlert>

            <!-- Errors -->
            <VAlert v-if="previewErrors.length > 0" type="error" variant="tonal" class="mb-4">
              <div class="text-h6 mb-2">Errors ({{ previewErrors.length }})</div>
              <ul>
                <li v-for="(error, idx) in previewErrors" :key="idx">
                  Row {{ error.row }}: {{ error.field }} - {{ error.message }}
                </li>
              </ul>
            </VAlert>

            <!-- Warnings -->
            <VAlert v-if="previewWarnings.length > 0" type="warning" variant="tonal" class="mb-4">
              <div class="text-h6 mb-2">Warnings ({{ previewWarnings.length }})</div>
              <ul>
                <li v-for="(warning, idx) in previewWarnings" :key="idx">
                  Row {{ warning.row }}: {{ warning.field }} - {{ warning.message }}
                </li>
              </ul>
            </VAlert>

            <!-- Preview Data Section -->
            <div class="text-h6 mb-3 d-flex align-center">
              <VIcon icon="tabler-table" color="var(--bm-navy)" class="me-2" />
              Preview Data
            </div>

            <!-- Preview Table -->
            <VDataTable
              :headers="previewHeaders"
              :items="previewData"
              :items-per-page="10"
              density="comfortable"
              class="preview-table"
            >
              <template #item.role="{ item }">
                <VChip
                  :color="item.role === 99 ? 'var(--bm-navy)' : 'default'"
                  size="small"
                >
                  {{ getRoleText(item.role) }}
                </VChip>
              </template>
            </VDataTable>
          </VStepperWindowItem>
          </VStepperWindow>
        </VStepper>
      </div>

      <div class="bmd-foot">
        <VBtn
          v-if="currentStep > 1 && !importStarted"
          class="bmd-btn-ghost"
          variant="text"
          height="50"
          @click="goToPreviousStep"
        >
          Previous
        </VBtn>
        <VSpacer />

        <VBtn
          v-if="currentStep < totalSteps"
          :disabled="!canProceedToNextStep || isLoadingPreview"
          :loading="isLoadingPreview"
          class="bmd-btn-primary"
          height="50"
          @click="goToNextStep"
        >
          Next
        </VBtn>

        <VBtn
          v-if="currentStep === totalSteps && !importStarted"
          :disabled="previewData.length === 0 || isImporting"
          :loading="isImporting"
          class="bmd-btn-primary"
          height="50"
          @click="performImport"
        >
          Import ({{ previewData.length }} users)
        </VBtn>

        <VBtn
          v-if="currentStep === totalSteps && importStarted && !isImporting"
          class="bmd-btn-primary"
          height="50"
          @click="closeAfterImport"
        >
          Tutup
        </VBtn>
      </div>
    </VCard>
  </VDialog>
</template>

<style scoped>
/* Keeps the head/footer fixed and lets only the stepper content scroll —
   this dialog's step 3 (preview table + alerts) can get much taller than
   the viewport, unlike the rest of the app's single-screen bm-dialogs. */
.imp-dialog {
  display: flex;
  flex-direction: column;
  max-height: 88vh;
}

.imp-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.bmd-foot {
  border-top: 1px solid var(--bm-line-soft);
}

.preview-table {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
}

:deep(.preview-table .v-data-table__wrapper) {
  background-color: rgb(var(--v-theme-surface));
}

:deep(.preview-table .v-data-table__thead) {
  background-color: color-mix(in oklab, var(--bm-navy) 8%, transparent);
}

:deep(.preview-table .v-data-table__thead th) {
  font-weight: 600 !important;
  color: rgb(var(--v-theme-on-surface)) !important;
}

:deep(.preview-table tbody tr) {
  background-color: rgb(var(--v-theme-surface));
}

:deep(.preview-table tbody tr:nth-child(even)) {
  background-color: rgba(var(--v-theme-on-surface), 0.02);
}

:deep(.preview-table tbody tr:hover) {
  background-color: color-mix(in oklab, var(--bm-navy) 8%, transparent) !important;
}
</style>
