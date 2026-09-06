/**
 * Auth-mejl (bekräftelse, återställning, …). Samma krom som offerter/fakturor
 * – Driva, inte "Supabase Auth".
 */
import { emailCta, emailLayout, escapeHtml } from "./templates";

export type AuthEmailKind =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change_current"
  | "email_change_new"
  | "reauthentication"
  | "password_changed_notification"
  | "email_changed_notification"
  | "phone_changed_notification"
  | "identity_linked_notification"
  | "identity_unlinked_notification"
  | "mfa_factor_enrolled_notification"
  | "mfa_factor_unenrolled_notification"
  | "notification";

export interface AuthEmailInput {
  kind: AuthEmailKind;
  confirmUrl?: string;
  token?: string;
  newEmail?: string;
}

interface AuthCopy {
  subject: string;
  heading: string;
  body: string;
  cta?: string;
  footer: string;
}

const LINK_FOOTER = "Länken slutar gälla om en timme och kan bara användas en gång.";

function copyFor(input: AuthEmailInput): AuthCopy {
  const newEmail = input.newEmail?.trim();
  switch (input.kind) {
    case "signup":
      return {
        subject: "Bekräfta din e-postadress i Driva",
        heading: "Bekräfta din e-post",
        body: "Du har skapat ett konto i Driva. Klicka på knappen för att bekräfta adressen och komma igång.",
        cta: "Bekräfta e-postadressen",
        footer: `${LINK_FOOTER} Om du inte skapade kontot kan du ignorera mejlet.`,
      };
    case "invite":
      return {
        subject: "Du är inbjuden till Driva",
        heading: "Du är inbjuden",
        body: "Du har bjudits in att skapa ett konto i Driva. Klicka på knappen för att acceptera.",
        cta: "Acceptera inbjudan",
        footer: `${LINK_FOOTER} Om du inte väntade dig mejlet kan du ignorera det.`,
      };
    case "magiclink":
      return {
        subject: "Logga in i Driva",
        heading: "Din inloggningslänk",
        body: "Klicka på knappen för att logga in i Driva.",
        cta: "Logga in",
        footer: `${LINK_FOOTER} Om du inte försökte logga in kan du ignorera mejlet.`,
      };
    case "recovery":
      return {
        subject: "Återställ lösenordet i Driva",
        heading: "Välj ett nytt lösenord",
        body: "Vi fick en begäran om att återställa lösenordet för ditt Driva-konto. Klicka på knappen för att välja ett nytt.",
        cta: "Välj nytt lösenord",
        footer: `${LINK_FOOTER} Om du inte begärde det kan du ignorera mejlet.`,
      };
    case "email_change_current":
      return {
        subject: "Bekräfta byte av e-post i Driva",
        heading: "Bekräfta e-postbytet",
        body: newEmail
          ? `Någon vill byta e-postadress på ditt Driva-konto till ${newEmail}. Bekräfta bytet här om det var du.`
          : "Någon vill byta e-postadress på ditt Driva-konto. Bekräfta bytet här om det var du.",
        cta: "Bekräfta e-postbytet",
        footer: `${LINK_FOOTER} Om du inte begärde bytet kan du ignorera mejlet.`,
      };
    case "email_change_new":
      return {
        subject: "Bekräfta din nya e-postadress i Driva",
        heading: "Bekräfta ny e-post",
        body: newEmail
          ? `Bekräfta att ${newEmail} ska vara din e-postadress i Driva.`
          : "Bekräfta din nya e-postadress i Driva.",
        cta: "Bekräfta ny e-postadress",
        footer: `${LINK_FOOTER} Om du inte begärde bytet kan du ignorera mejlet.`,
      };
    case "reauthentication":
      return {
        subject: "Din verifieringskod i Driva",
        heading: "Verifieringskod",
        body: "Använd koden nedan för att verifiera dig i Driva. Den slutar gälla snart.",
        footer: "Om du inte begärde koden kan du ignorera mejlet.",
      };
    case "password_changed_notification":
      return {
        subject: "Ditt lösenord i Driva har ändrats",
        heading: "Lösenordet har ändrats",
        body: "Lösenordet för ditt Driva-konto har ändrats. Om det inte var du: återställ det via Glömt lösenord på inloggningssidan.",
        footer: "Det här är ett automatiskt meddelande från Driva.",
      };
    case "email_changed_notification":
      return {
        subject: "E-postadressen för ditt Driva-konto har ändrats",
        heading: "E-postadressen har ändrats",
        body: newEmail
          ? `E-postadressen för ditt Driva-konto är nu ${newEmail}.`
          : "E-postadressen för ditt Driva-konto har ändrats.",
        footer: "Det här är ett automatiskt meddelande från Driva.",
      };
    case "phone_changed_notification":
      return {
        subject: "Telefonnumret för ditt Driva-konto har ändrats",
        heading: "Telefonnumret har ändrats",
        body: "Telefonnumret kopplat till ditt Driva-konto har ändrats.",
        footer: "Det här är ett automatiskt meddelande från Driva.",
      };
    case "identity_linked_notification":
      return {
        subject: "Ett konto har kopplats till Driva",
        heading: "Konto kopplat",
        body: "Ett externt inloggningskonto har kopplats till ditt Driva-konto.",
        footer: "Det här är ett automatiskt meddelande från Driva.",
      };
    case "identity_unlinked_notification":
      return {
        subject: "Ett konto har kopplats bort från Driva",
        heading: "Konto bortkopplat",
        body: "Ett externt inloggningskonto har kopplats bort från ditt Driva-konto.",
        footer: "Det här är ett automatiskt meddelande från Driva.",
      };
    case "mfa_factor_enrolled_notification":
      return {
        subject: "Tvåfaktorsinloggning är på i Driva",
        heading: "Tvåfaktorsinloggning på",
        body: "Tvåfaktorsinloggning har slagit på för ditt Driva-konto.",
        footer: "Det här är ett automatiskt meddelande från Driva.",
      };
    case "mfa_factor_unenrolled_notification":
      return {
        subject: "Tvåfaktorsinloggning är av i Driva",
        heading: "Tvåfaktorsinloggning av",
        body: "Tvåfaktorsinloggning har stängts av för ditt Driva-konto.",
        footer: "Det här är ett automatiskt meddelande från Driva.",
      };
    case "notification":
      return {
        subject: "Ett meddelande från Driva",
        heading: "Meddelande från Driva",
        body: "Du har ett meddelande om ditt Driva-konto.",
        footer: "Det här är ett automatiskt meddelande från Driva.",
      };
  }
}

export function authEmail(input: AuthEmailInput): { subject: string; text: string; html: string } {
  const copy = copyFor(input);
  const token = input.token?.trim();
  const url = input.confirmUrl?.trim();
  const textLines = [copy.heading, "", copy.body];
  if (token) {
    textLines.push("", token);
  }
  if (url && copy.cta) {
    textLines.push("", copy.cta + ":", url);
  }
  textLines.push("", copy.footer);

  const extraHtml = [
    token
      ? `<p style="margin:20px 0 0;font-size:28px;letter-spacing:0.12em;font-weight:650;">${escapeHtml(token)}</p>`
      : "",
    url && copy.cta ? emailCta(url, copy.cta) : "",
  ].join("");

  const html = emailLayout({
    title: "Driva",
    footer: copy.footer,
    bodyHtml: `
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;font-weight:650;">${escapeHtml(copy.heading)}</h1>
      <p style="margin:0;font-size:15px;line-height:1.55;">${escapeHtml(copy.body)}</p>
      ${extraHtml}
    `,
  });
  return { subject: copy.subject, text: textLines.join("\n"), html };
}
