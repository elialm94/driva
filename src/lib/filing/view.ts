/**
 * Vad inlämningspanelen behöver för en deklaration. Ett anrop per yta, så att
 * sidorna inte behöver känna providervalet eller signeringskroken.
 *
 * Inlämningsraden har inga hemligheter (tokens bor i miljön, aldrig i datan),
 * så den skickas som den är – till skillnad från bankkopplingen, som måste
 * projiceras innan den når UI:t.
 */
import type { FilingKind, FilingSubmission } from "../types";
import { isDemoFilingRequest, filingProviderKind, filingSubmissionAvailable } from "./select";
import { filingSigningAvailable } from "./signing";
import { latestFilingSubmission } from "./submission";

export interface FilingPanelData {
  kind: FilingKind;
  subjectId: string;
  submission: FilingSubmission | null;
  available: boolean;
  signingAvailable: boolean;
  demo: boolean;
}

export function filingPanelData(kind: FilingKind, subjectId: string): FilingPanelData {
  return {
    kind,
    subjectId,
    submission: latestFilingSubmission(kind, subjectId) ?? null,
    available: filingSubmissionAvailable(),
    signingAvailable: filingSigningAvailable(),
    demo: isDemoFilingRequest() && filingProviderKind() === "mock",
  };
}
