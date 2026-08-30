import { signupSuccessCopy } from "@/lib/auth/signup-flow";
import { ResendVerification } from "./resend-verification";

export function SignupSuccessBanner({ email }: { email: string | null }) {
  const copy = signupSuccessCopy(email);
  return (
    <div
      role="status"
      className="mb-4 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-900"
    >
      <p className="font-medium">✓ {copy.title}</p>
      <p className="mt-1 text-emerald-800">{copy.body}</p>
      {copy.emailLine ? <p className="mt-1 text-emerald-800">{copy.emailLine}</p> : null}
      {email ? (
        <div className="mt-2">
          <ResendVerification email={email} label="Fick du inget mejl? Skicka igen" />
        </div>
      ) : null}
    </div>
  );
}
