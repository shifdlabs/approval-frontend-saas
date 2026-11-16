// S3 object access for the browser.
//
// AUDIT SEC-01: the AWS SDK and long-lived IAM credentials that used to live
// here (and got inlined into the shipped bundle) have been removed. The backend
// now holds the credentials and hands out short-lived presigned URLs; the
// browser only performs the raw PUT/DELETE against the returned URL. Public
// read URLs (S3BucketUrl + key) are unchanged — the bucket base URL is not a
// secret.
import { $api } from '@/utils/api'

// Public read base URL of the storage bucket, e.g. a Cloudflare R2 r2.dev URL.
// Falls back to the original AWS bucket when VITE_S3_PUBLIC_URL is not set.
const LEGACY_AWS_BUCKET_URL = 'https://alpha-development-storage.s3.ap-southeast-3.amazonaws.com/'
const publicUrl = import.meta.env.VITE_S3_PUBLIC_URL || LEGACY_AWS_BUCKET_URL
export const S3BucketUrl = publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`

// s3KeyFromUrl returns the object key of a stored file URL, or undefined when
// the URL does not point at our bucket. Old AWS URLs are still recognised.
export function s3KeyFromUrl(url: string): string | undefined {
  if (url.startsWith(S3BucketUrl))
    return url.slice(S3BucketUrl.length).split('?')[0] || undefined
  return url.split('.amazonaws.com/')[1]?.split('?')[0] || undefined
}
export const AttachmentFolderName = 'document-attachments/'
export const SignatureFolderName = 'signatures/'

interface PresignResponse {
  data: {
    url: string
    method: string
    expiresIn: number
  }
}

// requestPresignedUrl asks the backend for a presigned URL for the given object
// key and HTTP method. The backend enforces auth, subscription, and an object
// key prefix allowlist.
async function requestPresignedUrl(key: string, method: 'PUT' | 'DELETE', contentType?: string): Promise<string> {
  const res = await $api<PresignResponse>('/upload/presign', {
    method: 'POST',
    body: { key, method, contentType },
  })
  if (!res?.data?.url)
    throw new Error('Failed to obtain presigned URL')
  return res.data.url
}

export async function uploadS3File(file: File, key: string) {
  const url = await requestPresignedUrl(key, 'PUT', file.type)
  const res = await fetch(url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  })
  if (!res.ok)
    throw new Error(`S3 upload failed with status ${res.status}`)
  return res
}

export async function deleteS3File(key: string) {
  const url = await requestPresignedUrl(key, 'DELETE')
  const res = await fetch(url, { method: 'DELETE' })
  // S3 returns 204 on delete; treat 404 as already-gone (idempotent).
  if (!res.ok && res.status !== 404)
    throw new Error(`S3 delete failed with status ${res.status}`)
  return res
}
