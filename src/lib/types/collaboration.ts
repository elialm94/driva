/**
 * Samarbete: inbjudningar och förfrågningar till klienten.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { ID } from "./common";
import type { CollaborationRole } from "./audit";

/* ------------------------------ Samarbete --------------------------------- */

export type CollaborationInviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface CollaborationInvitation {
  id: ID;
  businessId: ID;
  email: string;
  role: CollaborationRole;
  invitedByUserId: ID;
  invitedByName: string;
  /** SHA-256 av engångstoken – klartext lagras aldrig. */
  tokenHash: string;
  expiresAt: string;
  acceptedAt?: string;
  acceptedByUserId?: ID;
  revokedAt?: string;
  revokedByUserId?: ID;
  status: CollaborationInviteStatus;
  createdAt: string;
}

/**
 * Begäran från redovisningskonsult till ägaren (samma åtgärdsmotor).
 * När underlaget kommer in löses både Hem-raden och konsultkön.
 */
export type ClientInformationKind = "receipt" | "clarification" | "other";

export interface ClientInformationRequest {
  id: ID;
  kind: ClientInformationKind;
  /** Stabil åtgärdsid: `client-request-<id>`. */
  title: string;
  /** T.ex. "Anna behöver kvittot från Bauhaus, 875 kr." */
  message: string;
  expenseId?: ID;
  supplierInvoiceId?: ID;
  requestedByUserId: ID;
  requestedByName: string;
  requestedByRole: CollaborationRole;
  createdAt: string;
  resolvedAt?: string;
  resolvedByUserId?: ID;
}
