process.env.DRIVA_TEST = "1";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { authEmail } from "./email/auth-templates";
import {
  AUTH_MAIL_REQUIRES_LIVE,
  authConfirmUrl,
  handleSendEmailHook,
  parseSendEmailHookPayload,
  planAuthEmails,
  prepareAuthMail,
  sendAuthMail,
} from "./auth/send-email-hook";
import { setMailTransportForTests, type MailMessage } from "./mail";
import { signResendWebhook } from "./inbox/resend-signature";

const HOOK_SECRET_RAW = "driva-auth-email-hook-test-key";
const HOOK_SECRET = `whsec_${Buffer.from(HOOK_SECRET_RAW).toString("base64")}`;
const HOOK_SECRET_DASHBOARD = `v1,${HOOK_SECRET}`;

const SIGNUP_PAYLOAD = {
  user: { email: "erik@foretaget.se" },
  email_data: {
    token: "123456",
    token_hash: "abc123tokenhashvalue",
    redirect_to: "http://localhost:3123/auth/bekrafta",
    email_action_type: "signup",
    site_url: "http://localhost:3123",
    token_new: "",
    token_hash_new: "",
  },
};

function envBackup(keys: string[]): { restore: () => void } {
  const prev = new Map(keys.map((k) => [k, process.env[k]]));
  return {
    restore() {
      for (const [k, v] of prev) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

function signedHeaders(payload: string, secret = HOOK_SECRET) {
  const id = "msg_auth_1";
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": signResendWebhook(secret, id, timestamp, payload),
  };
}

describe("authEmail", () => {
  it("signup är Driva, inte Supabase, med svensk CTA", () => {
    const mail = authEmail({
      kind: "signup",
      confirmUrl: "http://localhost:3123/auth/bekrafta?token_hash=x&type=signup",
    });
    assert.equal(mail.subject, "Bekräfta din e-postadress i Driva");
    assert.match(mail.text, /Bekräfta e-postadressen/);
    assert.match(mail.html, /Driva/);
    assert.match(mail.html, /Bekräfta e-postadressen/);
    assert.doesNotMatch(mail.html, /Supabase/i);
    assert.doesNotMatch(mail.text, /Supabase/i);
    assert.doesNotMatch(mail.html, /Opt out|Unsubscribe/i);
  });

  it("återställning pekar på nytt lösenord", () => {
    const mail = authEmail({
      kind: "recovery",
      confirmUrl: "http://localhost:3123/auth/bekrafta?token_hash=x&type=recovery&next=%2Fuppdatera-losenord",
    });
    assert.equal(mail.subject, "Återställ lösenordet i Driva");
    assert.match(mail.text, /Välj nytt lösenord/);
    assert.match(mail.html, /uppdatera-losenord/);
  });
});

describe("authConfirmUrl", () => {
  it("landar på /auth/bekrafta med token_hash och type", () => {
    const url = authConfirmUrl({
      tokenHash: "hash-1",
      type: "signup",
      redirectTo: "http://localhost:3123/auth/bekrafta",
    });
    assert.equal(url, "http://localhost:3123/auth/bekrafta?token_hash=hash-1&type=signup");
  });

  it("behåller next från redirect_to och tvingar sökvägen till /auth/bekrafta", () => {
    const url = authConfirmUrl({
      tokenHash: "hash-2",
      type: "recovery",
      redirectTo: "https://app.driva.se/auth/bekrafta?next=%2Fuppdatera-losenord",
    });
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://app.driva.se");
    assert.equal(parsed.pathname, "/auth/bekrafta");
    assert.equal(parsed.searchParams.get("token_hash"), "hash-2");
    assert.equal(parsed.searchParams.get("type"), "recovery");
    assert.equal(parsed.searchParams.get("next"), "/uppdatera-losenord");
  });

  it("recovery utan next får /uppdatera-losenord", () => {
    const url = authConfirmUrl({
      tokenHash: "hash-3",
      type: "recovery",
      redirectTo: "http://localhost:3123/",
    });
    assert.match(url, /next=%2Fuppdatera-losenord/);
  });

  it("släpper inte javascript-redirect som origin", () => {
    const url = authConfirmUrl({
      tokenHash: "hash-4",
      type: "signup",
      redirectTo: "javascript:alert(1)",
    });
    assert.match(url, /^https?:\/\//);
    assert.doesNotMatch(url, /javascript:/);
  });
});

describe("planAuthEmails", () => {
  it("signup ger ett mejl till användaren", () => {
    const jobs = planAuthEmails(SIGNUP_PAYLOAD);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].to, "erik@foretaget.se");
    assert.equal(jobs[0].kind, "signup");
    assert.match(jobs[0].confirmUrl ?? "", /token_hash=abc123tokenhashvalue/);
    assert.match(jobs[0].confirmUrl ?? "", /type=signup/);
  });

  it("säkert e-postbyte ger två mejl med omvända hash", () => {
    const jobs = planAuthEmails({
      user: { email: "gammal@foretaget.se", new_email: "ny@foretaget.se" },
      email_data: {
        token: "111111",
        token_hash: "hash-for-new",
        token_new: "222222",
        token_hash_new: "hash-for-current",
        redirect_to: "http://localhost:3123/auth/bekrafta",
        email_action_type: "email_change",
      },
    });
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].to, "gammal@foretaget.se");
    assert.equal(jobs[0].kind, "email_change_current");
    assert.match(jobs[0].confirmUrl ?? "", /token_hash=hash-for-current/);
    assert.equal(jobs[1].to, "ny@foretaget.se");
    assert.equal(jobs[1].kind, "email_change_new");
    assert.match(jobs[1].confirmUrl ?? "", /token_hash=hash-for-new/);
  });

  it("avvisar signup utan token_hash", () => {
    assert.deepEqual(
      planAuthEmails({
        user: { email: "erik@foretaget.se" },
        email_data: { email_action_type: "signup", redirect_to: "http://localhost:3123/" },
      }),
      []
    );
  });
});

describe("handleSendEmailHook", () => {
  const sent: MailMessage[] = [];
  let env: { restore: () => void };

  beforeEach(() => {
    sent.length = 0;
    env = envBackup([
      "SEND_EMAIL_HOOK_SECRET",
      "RESEND_API_KEY",
      "RESEND_FROM_EMAIL",
      "RESEND_FROM_NAME",
    ]);
    process.env.SEND_EMAIL_HOOK_SECRET = HOOK_SECRET_DASHBOARD;
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM_EMAIL = "hej@driva.se";
    process.env.RESEND_FROM_NAME = "Driva";
    setMailTransportForTests(async (msg) => {
      sent.push(msg);
      return { messageId: "msg_auth" };
    });
  });

  afterEach(() => {
    setMailTransportForTests(undefined);
    env.restore();
  });

  it("skickar Driva-bekräftelse via Resend-transporten", async () => {
    const raw = JSON.stringify(SIGNUP_PAYLOAD);
    const headers = signedHeaders(raw);
    const result = await handleSendEmailHook({
      rawBody: raw,
      getHeader: (name) => headers[name as keyof typeof headers] ?? null,
    });
    assert.equal(result.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "erik@foretaget.se");
    assert.equal(sent[0].subject, "Bekräfta din e-postadress i Driva");
    assert.match(sent[0].html, /Bekräfta e-postadressen/);
    assert.doesNotMatch(sent[0].html, /Supabase/i);
    assert.equal(sent[0].from, "Driva <hej@driva.se>");
    assert.equal(sent[0].replyTo, undefined);
  });

  it("avvisar ogiltig signatur", async () => {
    const raw = JSON.stringify(SIGNUP_PAYLOAD);
    const result = await handleSendEmailHook({
      rawBody: raw,
      getHeader: () => null,
    });
    assert.equal(result.status, 401);
    assert.equal(sent.length, 0);
  });

  it("vägrar mock – auth-mejl får inte låtsas gå iväg", async () => {
    setMailTransportForTests(undefined);
    delete process.env.RESEND_API_KEY;
    const raw = JSON.stringify(SIGNUP_PAYLOAD);
    const headers = signedHeaders(raw);
    const result = await handleSendEmailHook({
      rawBody: raw,
      getHeader: (name) => headers[name as keyof typeof headers] ?? null,
    });
    assert.equal(result.status, 503);
    assert.match(String((result.body as { error?: { message?: string } }).error?.message), /RESEND/);
    assert.equal(sent.length, 0);
  });

  it("503 när hook-hemligheten saknas", async () => {
    delete process.env.SEND_EMAIL_HOOK_SECRET;
    const result = await handleSendEmailHook({
      rawBody: JSON.stringify(SIGNUP_PAYLOAD),
      getHeader: () => null,
    });
    assert.equal(result.status, 503);
  });
});

describe("sendAuthMail", () => {
  afterEach(() => {
    setMailTransportForTests(undefined);
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });

  it("testtransport räknas som riktigt utskick", async () => {
    const sent: MailMessage[] = [];
    setMailTransportForTests(async (msg) => {
      sent.push(msg);
      return { messageId: "t1" };
    });
    const jobs = planAuthEmails(SIGNUP_PAYLOAD);
    const result = await sendAuthMail(jobs[0]);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.mode, "test");
    assert.equal(sent[0].subject, "Bekräfta din e-postadress i Driva");
  });

  it("mock är fel för auth", async () => {
    setMailTransportForTests(undefined);
    const jobs = planAuthEmails(SIGNUP_PAYLOAD);
    const result = await sendAuthMail(jobs[0]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, AUTH_MAIL_REQUIRES_LIVE);
  });
});

describe("parseSendEmailHookPayload", () => {
  it("kräver user och email_data", () => {
    assert.deepEqual(parseSendEmailHookPayload(null), { error: "Ogiltig JSON" });
    assert.deepEqual(parseSendEmailHookPayload({}), { error: "Saknar user" });
    assert.deepEqual(parseSendEmailHookPayload({ user: {} }), { error: "Saknar email_data" });
  });

  it("prepareAuthMail sätter ingen reply-to", () => {
    const jobs = planAuthEmails(SIGNUP_PAYLOAD);
    const message = prepareAuthMail(jobs[0]);
    assert.equal(message.replyTo, undefined);
    assert.match(message.html, /font-family/);
  });
});
