import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import API from "../../api/client";
import { RecoveryCodes, confirmMfaEnrollment, startMfaEnrollment } from "../auth/MfaChallenge";
import s from "./EditProfileModal.module.css";

interface MfaStatus { enabled: boolean; required: boolean; recoveryCodesLeft: number }

/**
 * Two-step verification (P2.1): required for administrators, optional for
 * everyone else. Setup shows a QR code, then one-time recovery codes.
 */
export default function TwoStepVerification() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    API.get<MfaStatus>("/auth/mfa/status").then(({ data }) => setStatus(data)).catch(() => setStatus(null));
  }, []);
  useEffect(load, [load]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await action();
    } catch (err: any) {
      setMsg({ ok: false, text: err.response?.data?.error || "Something went wrong" });
    } finally {
      setBusy(false);
    }
  };

  const begin = () => run(async () => {
    const { data } = await startMfaEnrollment({});
    setSetup({ secret: data.secret, qrDataUrl: data.qrDataUrl });
  });
  const confirm = () => run(async () => {
    const { data } = await confirmMfaEnrollment({ code });
    setCodes((data as { recoveryCodes?: string[] }).recoveryCodes || []);
    setSetup(null);
    setCode("");
    load();
  });
  const disable = () => run(async () => {
    await API.post("/auth/mfa/disable", { code });
    setCode("");
    setMsg({ ok: true, text: "Two-step verification is off." });
    load();
  });

  if (!status) return null;
  return (
    <section className={s.section}>
      <h3 className={s.sectionTitle}>
        <ShieldCheck size={15} style={{ verticalAlign: "middle", marginRight: 6 }} />
        Two-step verification
      </h3>
      <p className={s.dangerDesc} style={{ color: "var(--text-secondary)" }}>
        {status.enabled
          ? `On. Sign-in and admin changes ask for a code from your authenticator app. ${status.recoveryCodesLeft} recovery codes left.`
          : status.required
            ? "Required for administrators. Set it up now to keep admin access."
            : "Add a code from an authenticator app to your sign-in."}
      </p>
      {msg && <p className={msg.ok ? s.success : s.error}>{msg.text}</p>}
      {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}
      {setup && (
        <div style={{ marginBottom: 8 }}>
          <img src={setup.qrDataUrl} alt="Authenticator setup QR code" width={160} height={160} />
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", wordBreak: "break-all" }}>Key: <code>{setup.secret}</code></div>
        </div>
      )}
      {(setup || (status.enabled && !status.required)) && (
        <input className={s.deleteInput} inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code"
          value={code} onChange={(e) => setCode(e.target.value)} />
      )}
      {!status.enabled && !setup && <button className={s.saveBtn} disabled={busy} onClick={begin}>Set up two-step verification</button>}
      {setup && <button className={s.saveBtn} disabled={busy || !code} onClick={confirm}>Turn on</button>}
      {status.enabled && !status.required && <button className={s.cancelBtn} disabled={busy || !code} onClick={disable}>Turn off</button>}
    </section>
  );
}
