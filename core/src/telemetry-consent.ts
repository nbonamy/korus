import type { SealedTelemetryBody } from "./telemetry";

/** Returned only to the local desktop settings caller, never in shared state. */
export type TelemetryConsentView = {
  enabled: boolean;
  eligibleFrom: number | null;
  noticePending: boolean;
};
export type TelemetryConsentAction = "enable" | "disable" | "dismiss" | "reset";
export type TelemetryProfilePreview = SealedTelemetryBody & {
  kind: "hypothetical" | "provisional" | "sealed";
};
/** Backend-only authority passed directly to the delivery owner. Do not add to snapshots. */
export type TelemetryConsentState = {
  installId: string;
  enabled: boolean;
  eligibleFrom: number | null;
  noticeHandled: boolean;
};
export type TelemetryConsentTransition = {
  reason: "enable" | "disable" | "reset";
  previous: Readonly<TelemetryConsentState>;
  current: Readonly<TelemetryConsentState>;
};
/** The single delivery owner cancels/purges on disable/reset and checks
 * current authority before every attempt. These callbacks never accept payloads.
 */
export type TelemetryDeliveryPort = {
  consentChanged(transition: TelemetryConsentTransition): Promise<void>;
  sealedReport(day: string): Promise<SealedTelemetryBody | null>;
};

/** Local desktop supplies an observed activity instant; no payload or timestamp. */
export type TelemetryActivityPort = { activity(): Promise<void> };
