import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { redeemRealmHandoff } from "../api/workforce";
import { useAuth, currentRealm } from "../AuthContext";
import MfaChallenge, { mfaChallengeFrom, type MfaChallengeState } from "../components/auth/MfaChallenge";

export default function RealmHandoff() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { saveAuth } = useAuth() as any;
  const [error, setError] = useState("");
  // P2.1: an administrator finishes the second factor here, on the target host.
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallengeState | null>(null);
  const finish = (data: unknown) => {
    saveAuth((data as any).user);
    navigate(currentRealm() === "platform" ? "/tenants" : "/", { replace: true });
  };
  useEffect(() => {
    // Prefer the URL fragment: unlike a query string it is never sent to the
    // CDN/origin or access logs. Query support remains for rolling deploys.
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const ticket = fragment.get("t") || params.get("t");
    if (!ticket) { setError("Missing realm handoff ticket"); return; }
    redeemRealmHandoff(ticket).then(({ data }) => finish(data)).catch((e) => {
      const challenge = mfaChallengeFrom(e.response?.data);
      if (challenge) setMfaChallenge(challenge);
      else setError(e.response?.data?.error || "Realm handoff failed");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, navigate, saveAuth]);
  if (mfaChallenge) {
    return (
      <main style={{ padding: 32, maxWidth: 420, margin: "0 auto" }}>
        <MfaChallenge challenge={mfaChallenge} onSignedIn={finish} onCancel={() => navigate("/login", { replace: true })} />
      </main>
    );
  }
  return <main style={{ padding: 32 }}>{error || "Switching workspace…"}</main>;
}