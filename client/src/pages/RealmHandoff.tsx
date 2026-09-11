import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { redeemRealmHandoff } from "../api/workforce";
import { useAuth, currentRealm } from "../AuthContext";

export default function RealmHandoff() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { saveAuth } = useAuth() as any;
  const [error, setError] = useState("");
  useEffect(() => {
    // Prefer the URL fragment: unlike a query string it is never sent to the
    // CDN/origin or access logs. Query support remains for rolling deploys.
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const ticket = fragment.get("t") || params.get("t");
    if (!ticket) { setError("Missing realm handoff ticket"); return; }
    redeemRealmHandoff(ticket).then(({ data }) => {
      saveAuth((data as any).user);
      navigate(currentRealm() === "platform" ? "/tenants" : "/", { replace: true });
    }).catch((e) => setError(e.response?.data?.error || "Realm handoff failed"));
  }, [params, navigate, saveAuth]);
  return <main style={{ padding: 32 }}>{error || "Switching workspace…"}</main>;
}