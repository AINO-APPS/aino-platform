import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getClientUpgrade, subscribeClientUpgrade } from "../../api/clientUpgrade";
import type { ClientUpgradeRequired } from "../../types/generated/tasks";
import s from "./ClientUpgradeBoundary.module.css";

function UpgradeScreen({ requirement, reload }: { requirement: ClientUpgradeRequired; reload: () => void }) {
    const api = window.electronAPI;
    const heading = useRef<HTMLHeadingElement>(null);
    const [status, setStatus] = useState<"checking" | "downloading" | "ready" | "error">("checking");
    const [message, setMessage] = useState("");
    const check = useCallback(async () => {
        if (!api) return;
        setStatus("checking");
        setMessage("");
        try {
            const result = await api.checkForUpdate();
            if (!result.available && result.reason !== "check-in-progress") {
                setStatus("error");
                setMessage(result.error || "The required update is not available yet. Try again shortly.");
            }
        } catch {
            setStatus("error");
            setMessage("We couldn’t reach the update service. Check your connection and try again.");
        }
    }, [api]);
    useEffect(() => {
        heading.current?.focus();
        if (!api) return;
        const cleanups = [
            api.onUpdateAvailable?.(() => setStatus("downloading")),
            api.onUpdateDownloaded?.(() => setStatus("ready")),
            api.onUpdateReminder?.(() => setStatus("ready")),
            api.onUpdateError?.(info => {
                setStatus("error");
                setMessage(info.message || "The update could not be downloaded. Please try again.");
            }),
        ];
        void check();
        return () => cleanups.forEach(cleanup => cleanup?.());
    }, [api, check]);
    return <main className={s.page} aria-labelledby="upgrade-heading">
        <section className={s.panel}>
            <p className={s.eyebrow}>AINO <span aria-hidden="true">/</span> UPDATE REQUIRED</p>
            <div className={s.rule} aria-hidden="true" />
            <h1 id="upgrade-heading" tabIndex={-1} ref={heading}>A newer AINO is ready</h1>
            <p className={s.description}>{api
                ? "Update your desktop app to keep working with your team. AINO will restart to apply the update."
                : "This tab is using an older version. Reload to continue with the latest AINO."}</p>
            <dl className={s.versions}>
                <div><dt>Your version</dt><dd>{requirement.current_version}</dd></div>
                <div><dt>Required</dt><dd>{requirement.min_version}</dd></div>
            </dl>
            <div aria-live="polite" className={s.status}>
                {api && status === "checking" && "Checking for the latest update…"}
                {api && status === "downloading" && "Downloading your update…"}
                {api && status === "ready" && "Update downloaded. You’re ready to restart."}
                {api && status === "error" && message}
            </div>
            {!api && <button className="btn btn-primary" onClick={reload}>Reload AINO</button>}
            {api && status === "ready" && <button className="btn btn-primary" onClick={() => api.installUpdate()}>Restart to update</button>}
            {api && status === "error" && <button className="btn btn-primary" onClick={() => void check()}>Try update again</button>}
            <p className={s.footnote}>Your account and saved work stay right here.</p>
        </section>
    </main>;
}

export default function ClientUpgradeBoundary({
    children, reload = () => window.location.reload(),
}: { children: React.ReactNode; reload?: () => void }) {
    const requirement = useSyncExternalStore(subscribeClientUpgrade, getClientUpgrade, () => null);
    return requirement ? <UpgradeScreen requirement={requirement} reload={reload} /> : <>{children}</>;
}
