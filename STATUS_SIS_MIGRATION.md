# Status Migrasi Approval Frontend — Sinkronisasi dengan Approval Backend & SIS (Phase 2)

Tanggal: 2026-06-23

Dokumen ini menjelaskan kondisi `approval-frontend` saat ini terkait migrasi
multi-tenant (Approval Backend Phase 2) dan integrasi SIS (Shifd Identity
Service), serta penyesuaian yang masih perlu dilakukan agar tiga sisi
(Frontend, Approval Backend, SIS) konsisten.

---

## 1. Kondisi Saat Ini

### Auth flow (sudah pindah ke SIS)

- `src/composables/useSisApi.ts` — klien `ofetch` terpisah (`sisApi`) khusus
  untuk SIS, base URL dari `VITE_SIS_BASE_URL`. Dipisah dari `useApi` karena
  envelope response SIS berbeda (`{ data, message }` / error `{ error, code }`
  ber-SNAKE_CASE) dari envelope Approval (`{ success, code, message, data }`).
- `src/controllers/login-controller.ts` — login 2 langkah:
  1. `sisApi('/api/auth/login')` → dapat `access_token`, `refresh_token`,
     `user`, `org` dari SIS. Disimpan ke cookie (`accessToken`,
     `refreshToken`, `name`, `userId`).
  2. `useApi('/user/profile')` ke Approval Backend (pakai `access_token` SIS
     sebagai Bearer) → dapat `role` (int, 99=admin) dan `position` lokal milik
     Approval, dipakai untuk routing (`/admin/users` vs `/reguler/dashboard`)
     dan disimpan ke cookie `role` / `jobPosition`.
  - Kalau `org` dari SIS `null` (user belum jadi member organisasi manapun) →
    redirect ke `/access-restricted?reason=org_missing` tanpa pernah memanggil
    Approval Backend.
- `src/layouts/components/UserProfile.vue` (logout) — best-effort revoke ke
  `sisApi('/api/auth/logout')`, lalu hapus semua cookie lokal. Tidak
  memblokir logout kalau call ke SIS gagal (logout tetap jalan).
- `src/pages/forgot-password.vue` & `reset-password.vue` — **tetap** memakai
  `useApi` (Approval Backend), **bukan** `sisApi`. Ini sesuai dengan
  `CLAUDE.md` backend: "Only the password-reset flow ... remains, and stays
  public."
- Tidak ada halaman register di FE — sesuai ekspektasi (`register` sudah
  sepenuhnya milik SIS, di luar repo ini).

### Token refresh & error handling

- `src/composables/useApi.ts`:
  - `beforeFetch` — decode JWT lokal (`isJwtExpired`), kalau expired panggil
    `refreshingToken()` yang hit `sisApi('/api/auth/refresh')` (endpoint
    publik, modal `refresh_token` di body, tanpa header Authorization).
  - `handleAuthErrorCode(errorCode)` — baca field `errorCode` dari body error
    Approval Backend dan react:
    - `UNAUTHORIZED` → hapus cookie token, redirect ke `/`.
    - `SUBSCRIPTION_INACTIVE` → redirect ke
      `/access-restricted?reason=subscription_inactive`.
    - `ORG_MISSING` → redirect ke `/access-restricted?reason=org_missing`.
  - Tiga code ini **cocok 1:1** dengan yang diproduksi
    `config/middleware/jwks_middleware.go` (`errorResponse()`) di Approval
    Backend — sinkron.
- `src/pages/access-restricted.vue` — menampilkan pesan sesuai
  `?reason=subscription_inactive` / `?reason=org_missing`, sejalan dengan dua
  kode di atas.

### Routing / role gating

- `src/plugins/1.router/index.ts` — guard hanya biner: ada/tidaknya cookie
  `accessToken`. Path yang dilindungi (`/admin`, `/reguler`, `/document`,
  `/profile`, `/preview`) sesuai daftar di `approval-frontend/CLAUDE.md`
  ("Route Guard — Path yang Dilindungi").
- Gating admin (menu `VerticalNav.vue`, `navigation/vertical/index.ts`) masih
  pakai cookie `role` (int lokal Approval, dari kolom `users.role`), **bukan**
  klaim `org_role` dari JWT SIS. Approval Backend juga masih begitu —
  `AdminOnly` middleware (`config/middleware/auth_middleware.go`) query
  `SELECT role FROM users WHERE id = ?`, dengan komentar TODO eksplisit untuk
  pindah ke `org_role`. Jadi FE dan BE konsisten satu sama lain, tapi
  **keduanya** belum pindah ke model `org_role` dari SIS.

### Pembuatan & manajemen member organisasi

- `src/components/dialogs/CreateUserDialog.vue` — form admin untuk
  menambah user, `POST /user` ke Approval Backend. Masih mengirim
  `password` + `confirmPassword` — Approval Backend saat ini masih
  menerima & hash password sendiri (field `Password` belum dihapus dari
  `model.User`, sesuai `CLAUDE.md` backend bagian "What Gets Removed" yang
  menunda penghapusan field auth user "in a later step, after migration is
  stable").
- `src/components/dialogs/ImportUsersDialog.vue` — bulk import lewat Excel,
  `POST /user/import/preview` lalu `/user/import/bulk`. Sama seperti di atas,
  masih bisa set custom password / auto-generate password di sisi Approval.
- `src/components/dialogs/UpdateUserDialog.vue` — `PUT /user`, tidak kirim
  password (field `password`/`confirmPassword` di `formData` ada tapi tidak
  pernah dipakai di body request maupun template — dead state, bukan bug
  fungsional).

---

## 2. Yang Sudah Sinkron dengan Backend & SIS

| Area | Frontend | Backend / SIS | Status |
|---|---|---|---|
| Login/refresh/logout/register | Pindah total ke `sisApi` | SIS yang issue & validasi token | ✅ Sinkron |
| Forgot/reset password | Tetap di `useApi` (Approval) | Tetap public di Approval (`/api/auth/forgot-password`, `/reset-password`) | ✅ Sinkron |
| Error code auth (`UNAUTHORIZED`, `SUBSCRIPTION_INACTIVE`, `ORG_MISSING`) | Ditangani di `handleAuthErrorCode` | Diproduksi oleh `jwks_middleware.go` | ✅ Sinkron |
| Path yang butuh auth (`/admin`, `/reguler`, `/document`, `/profile`, `/preview`) | Diset di router guard | Sesuai daftar di `CLAUDE.md` FE | ✅ Sinkron |
| Bearer token di setiap request | `Authorization: Bearer <accessToken dari SIS>` | `JWKSAuth` validasi via JWKS SIS | ✅ Sinkron |

---

## 3. Gap — Belum Disesuaikan

### 3.1 `USER_LIMIT_REACHED` belum ditangani di FE (baru, perlu segera)

Approval Backend (`controller/user.controller.go`, fungsi `Create`) baru saja
ditambah pengecekan `user_limit` dari klaim JWT SIS. Kalau admin organisasi
mencoba menambah member baru lewat `POST /user` saat kuota sudah penuh,
backend balas **403** dengan body:

```json
{
  "error": "Batas user untuk plan kamu sudah tercapai. Hubungi tim Shifd Labs untuk upgrade.",
  "code": "USER_LIMIT_REACHED",
  "current": 5,
  "limit": 5
}
```

Tapi `CreateUserDialog.vue` (`createNewUser()`) hanya mengecek
`data.value?.success` — body di atas tidak punya field `success`, jadi akan
selalu jatuh ke `else` dan menampilkan pesan generic
`t('common.errorFormInput')`, bukan pesan limit yang sebenarnya dari backend.

**Perlu**: tangkap `code === 'USER_LIMIT_REACHED'` secara eksplisit di
`createNewUser()` dan tampilkan `error` dari response (atau pesan custom +
`current`/`limit`) ke admin, alih-alih pesan generic.

### 3.2 Bulk import (`/user/import/bulk`) bisa tembus limit

Limit baru di atas hanya dipasang di handler `Create` (single user). Endpoint
`POST /user/import/bulk` yang dipakai `ImportUsersDialog.vue` masih bisa
membuat member baru tanpa batas — baik dari sisi backend (belum ada
pengecekan di sana) maupun frontend (dialog tidak tahu soal limit sama
sekali). Kalau scope-nya mau diperluas, backend perlu pasang pengecekan yang
sama di `BulkImport`, dan FE perlu menampilkan berapa baris yang gagal karena
limit (mirip pola `errors[]` yang sudah ada di response bulk import).

### 3.3 `org_role` (klaim SIS) belum dipakai di FE maupun BE

Gating admin di kedua sisi masih pakai kolom `users.role` lokal Approval,
bukan `org_role` dari JWT SIS (`owner`/`admin`/`member`). Ini bukan bug akut
karena FE dan BE konsisten satu sama lain, tapi keduanya punya technical debt
yang sama dan idealnya dibereskan bersamaan saat backend mengeksekusi Step 4
(`organization_id` di semua query) — supaya tidak ada dua sumber kebenaran
untuk "siapa admin".

### 3.4 Form create/import user masih minta password manual

`CreateUserDialog.vue` dan `ImportUsersDialog.vue` masih mengasumsikan
Approval Backend yang membuat & hash password member baru. Begitu backend
mengeksekusi **Step 5** (hapus field auth dari `model.User`, sesuai
`CLAUDE.md` backend), kedua form ini harus dirombak: tidak lagi minta
password saat admin invite member — alurnya akan jadi "invite via SIS" (SIS
buat akun & kirim link/email, user set password sendiri di SIS), bukan admin
yang menentukan password lewat dialog Approval.

### 3.5 Route guard masih biner (token ada/tidak ada saja)

`router.beforeEach` di `src/plugins/1.router/index.ts` hanya cek keberadaan
cookie `accessToken`, tidak cek validitas/expiry maupun org/subscription di
level route. Semua validasi org/subscription baru ketahuan reaktif setelah
request API pertama gagal (lewat `handleAuthErrorCode`). Ini cukup untuk
sekarang (UX-nya: render sekilas lalu redirect), tapi kalau mau early-redirect
yang lebih mulus, guard bisa decode token & cek `exp` di level router juga
(fungsi `isJwtExpired` di `useApi.ts` sudah ada, bisa diekspor & dipakai
ulang).

---

## 4. Rekomendasi Urutan Pengerjaan

1. **Cepat, langsung selaras dengan kerjaan backend yang baru selesai** —
   tangani `USER_LIMIT_REACHED` di `CreateUserDialog.vue` (3.1).
2. **Putuskan scope limit** — apakah `BulkImport` juga perlu dibatasi (3.2).
   Kalau ya, ini butuh perubahan backend dulu sebelum FE menyesuaikan.
3. **Technical debt `org_role` vs `role` lokal** (3.3) — tidak urgent selama
   FE & BE tetap konsisten, tapi catat sebagai item yang harus dieksekusi
   bersamaan, bukan sepihak salah satu sisi.
4. **Rombak form password saat backend mengeksekusi Step 5** (3.4) — tunggu
   sinyal dari backend bahwa field auth di `model.User` sudah resmi dihapus,
   baru ubah FE secara terkoordinasi (kalau FE diubah duluan, create/update
   user akan kirim field yang sudah tidak ada gunanya; kalau backend diubah
   duluan tanpa FE menyesuaikan, request `password` yang masih dikirim FE
   akan diabaikan begitu saja sampai FE benar-benar pindah ke alur invite SIS).
