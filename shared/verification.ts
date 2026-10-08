export type VerificationStatus = "starting" | "calling" | "processing" | "completed" | "failed";

export type Verification = {
  stationId: string;
  status: VerificationStatus;
  callId?: string;
  createdAt: string;
  checkedAt?: string;
  durationSeconds?: number;
  durationLimitSeconds?: number;
  costUsd?: number;
  confidence?: number;
  summary?: string;
  operational?: string;
  publicAccess?: string;
  chargingProcess?: string;
  chargerDetails?: string;
  transcript?: string;
  audioUrl?: string;
  recordingError?: string;
  error?: string;
};

export type VerificationResponse = {
  configured: boolean;
  missing: string[];
  verification: Verification | null;
  budget?: { usedUsd: number; limitUsd: number; calls: number; maxCalls: number; minimumCallUsd: number };
};

export const activeVerification = (value?: Verification | null) =>
  Boolean(value && ["starting", "calling", "processing"].includes(value.status));
