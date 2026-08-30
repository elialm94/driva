import { absoluteAppUrl } from "../mail";
import { sendCollaborationInvite } from "../email/service";
import type { CollaborationInvitation, CollaborationRole } from "../types";
import { roleLabel } from "./permissions";
import { INVITE_TTL_MS } from "./invitations";

export function inviteAcceptPath(token: string): string {
  return `/inbjudan/${encodeURIComponent(token)}`;
}

export async function sendCollaborationInviteEmail(input: {
  invitation: CollaborationInvitation;
  token: string;
  companyName: string;
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const role = roleLabel(input.invitation.role as CollaborationRole);
  const url = absoluteAppUrl(inviteAcceptPath(input.token));
  const result = await sendCollaborationInvite({
    to: input.invitation.email,
    invitationId: input.invitation.id,
    invitedByName: input.invitation.invitedByName,
    companyName: input.companyName,
    roleLabel: role,
    url,
    expiresDays: Math.round(INVITE_TTL_MS / (24 * 60 * 60 * 1000)),
  });
  return result.ok
    ? { ok: true, messageId: result.messageId }
    : { ok: false, error: result.error };
}
