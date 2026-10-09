import React, { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import API from "../../api/client";

export interface MfaChallengeState {
  code: "MFA_REQUIRED" | "MFA_ENROLL_REQUIRED";
  mfaTicket: string;
}

/** True when a login error asks for a second factor. */
export function mfaChallengeFrom(data: unknown): MfaChallengeState | null {
  const body = data as { code?: string; mfaTicket?: string } | undefined;
  if ((body?.code === "MFA_REQUIRED" || body?.code === "MFA_ENROLL_REQUIRED") && body.mfaTicket) {
    return { code: body.code, mfaTicket: body.mfaTicket };
  }
  return null;
}

export const verifyMfa = (mfaTicket: string, code: string) => API.post("/auth/mfa/verify", { mfaTicket, code });
export const startMfaEnrollment = (body: { mfaTicket?: string }) =>
  API.post<{ secret: string; otpauthUrl: string; qrDataUrl: string }>("/auth/mfa/enroll/start", body);
export const confirmMfaEnrollment = (body: { mfaTicket?: string; code: string }) =>
  API.post("/auth/mfa/enroll/confirm", body);
export const stepUpMfa = (code: string) => API.post("/auth/mfa/step-up", { code });

/** Recovery codes, shown exactly once after enrolment. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div>
      <p style={{ color: "var(--text-secondary)", marginBottom: 12 }}>
        Save these recovery codes somewhere safe. Each one works once if you lose your phone. They won't be shown again.
      </p>
      <pre style={{ background: "var(--input-bg)", padding: 12, borderRadius: 8, columns: 2, fontSize: "0.9rem", userSelect: "all" }}>
        {codes.join("\n")}
      </pre>
      <button type="button" className="btn btn-primary btn-fullwidth" onClick={onDone}>
        I saved my recovery codes
      </button>
    </div>
  );
}

/**
 * Sign-in step 2 for administrators (P2.1): enter a 6-digit code (or a
 * recovery code), or set up an authenticator app when none is enrolled yet.
 */
export default function MfaChallenge({
  challenge,
  onSignedIn,
  onCancel,
}: {
  challenge: MfaChallengeState;
  onSignedIn: (data: unknown) => void;
  onCancel: () => void;
}) {
  const enroll = challenge.code === "MFA_ENROLL_REQUIRED";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [recovery, setRecovery] = useState<{ codes: string[]; data: unknown } | null>(null);

  useEffect(() => {
    if (!enroll) return;
    startMfaEnrollment({ mfaTicket: challenge.mfaTicket })
      .then(({ data }) => setSetup({ secret: data.secret, qrDataUrl: data.qrDataUrl }))
      .catch((err) => setError(err.response?.data?.error || "Couldn't start setup. Sign in again."));
  }, [enroll, challenge.mfaTicket]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (enroll) {
        const { data } = await confirmMfaEnrollment({ mfaTicket: challenge.mfaTicket, code });
        setRecovery({ codes: (data as { recoveryCodes?: string[] }).recoveryCodes || [], data });
      } else {
        const { data } = await verifyMfa(challenge.mfaTicket, code);
        onSignedIn(data);
      }
    } catch (err: any) {
      if (err.response?.data?.code === "MFA_TICKET_INVALID") onCancel();
      setError(err.response?.data?.error || "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  if (recovery) return <RecoveryCodes codes={recovery.codes} onDone={() => onSignedIn(recovery.data)} />;

  return (
    <form onSubmit={submit}>
      <p style={{ color: "var(--text-secondary)", marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <ShieldCheck size={18} />
        {enroll
          ? "Administrators need two-step verification. Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), then enter the 6-digit code."
          : "Enter the 6-digit code from your authenticator app, or one of your recovery codes."}
      </p>
      {enroll && setup && (
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <img src={setup.qrDataUrl} alt="Authenticator setup QR code" width={180} height={180} />
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", wordBreak: "break-all" }}>
            Can't scan? Enter this key: <code>{setup.secret}</code>
          </div>
        </div>
      )}
      {error && <div className="error-msg">{error}</div>}
      <div className="form-group">
        <label htmlFor="mfa-code">{enroll ? "6-digit code" : "Code"}</label>
        <input
          id="mfa-code"
          inputMode={enroll ? "numeric" : "text"}
          autoComplete="one-time-code"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={enroll ? "123456" : "123456 or XXXXX-XXXXX"}
          required
        />
      </div>
      <button type="submit" className="btn btn-primary btn-fullwidth" disabled={busy || (enroll && !setup)}>
        {busy ? "Verifying..." : enroll ? "Turn on and sign in" : "Verify"}
      </button>
      <button type="button" className="btn btn-fullwidth" style={{ marginTop: 8 }} onClick={onCancel}>
        Back
      </button>
    </form>
  );
}
