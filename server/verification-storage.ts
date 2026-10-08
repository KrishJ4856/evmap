import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function r2() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}

export async function checkRecordingStorage() {
  await r2().send(new HeadBucketCommand({ Bucket: process.env.R2_BUCKET_NAME }), { abortSignal: AbortSignal.timeout(10_000) });
}

export async function saveRecording(callId: string, recordingUrl: string) {
  // This URL only ever comes from Retell's authenticated Get Call response.
  const response = await fetch(recordingUrl, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error("Recording download failed.");
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length || audio.length > 15 * 1024 * 1024) throw new Error("Unexpected recording size.");
  const key = `verifications/${callId}.wav`;
  await r2().send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: audio,
    ContentType: response.headers.get("content-type") || "audio/wav",
  }), { abortSignal: AbortSignal.timeout(20_000) });
  return key;
}

export async function recordingPlaybackUrl(key: string) {
  return getSignedUrl(r2(), new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }), { expiresIn: 3600 });
}
