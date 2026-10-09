import { useCallback, useEffect, useState } from "react";
import { Monitor, Smartphone, LogOut } from "lucide-react";
import API from "../../api/client";
import s from "./EditProfileModal.module.css";

interface SignedInDevice {
    id: string;
    device: string;
    clientClass: "mobile" | "web";
    lastActiveAt?: string | null;
    current: boolean;
}

export const listSignedInDevices = () => API.get<SignedInDevice[]>("/sessions");
export const signOutDevice = (id: string) => API.delete(`/sessions/${encodeURIComponent(id)}`);

/**
 * Signed-in devices (P2.7): one phone and one browser / desktop at a time.
 * Lets the user sign the other device out immediately.
 */
export default function SignedInDevices() {
    const [devices, setDevices] = useState<SignedInDevice[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        try {
            setDevices((await listSignedInDevices()).data || []);
        } catch {
            setError("Couldn't load your signed-in devices.");
        }
    }, []);
    useEffect(() => { void load(); }, [load]);

    const signOut = async (device: SignedInDevice) => {
        if (!window.confirm(`Sign out ${device.device}? It will need your password to sign in again.`)) return;
        setBusy(device.id);
        setError("");
        try {
            await signOutDevice(device.id);
            setDevices((list) => list.filter((d) => d.id !== device.id));
        } catch {
            setError("Couldn't sign that device out.");
        } finally {
            setBusy(null);
        }
    };

    return (
        <section className={s.section}>
            <h3 className={s.sectionTitle}>
                <Monitor size={15} style={{ verticalAlign: "middle", marginRight: 6 }} />
                Signed-in devices
            </h3>
            <p className={s.dangerDesc} style={{ color: "var(--text-secondary)" }}>
                Your account can be signed in on one phone and one browser or desktop app at a time.
                Signing in somewhere new signs the old device of that kind out.
            </p>
            {error && <p className={s.error}>{error}</p>}
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {devices.map((d) => (
                    <li
                        key={d.id}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", padding: "0.5rem 0", borderBottom: "1px solid var(--glass-border)" }}
                    >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                            {d.clientClass === "mobile" ? <Smartphone size={14} /> : <Monitor size={14} />}
                            <span>
                                {d.device}
                                <span style={{ color: "var(--text-secondary)", fontSize: "0.8rem", marginLeft: 6 }}>
                                    {d.current ? "This device" : d.lastActiveAt ? `Last active ${new Date(d.lastActiveAt).toLocaleString()}` : ""}
                                </span>
                            </span>
                        </span>
                        {!d.current && (
                            <button className={s.cancelBtn} onClick={() => signOut(d)} disabled={busy === d.id} aria-label={`Sign out ${d.device}`}>
                                <LogOut size={14} />
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}
