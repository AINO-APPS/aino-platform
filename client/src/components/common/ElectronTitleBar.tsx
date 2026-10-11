import { Minus as MaterialMinus, WindowRestore as MaterialWindowRestore, WindowMaximize as MaterialWindowMaximize, X as MaterialX } from "../../constants/icons";
import { useState, useEffect } from "react";

const isElectron = !!window.electronAPI?.isElectron;
const isMac = window.electronAPI?.platform === "darwin";

/* Minimal drag region + window controls for frameless Electron when Navbar is hidden (login, register, etc.) */
export default function ElectronTitleBar() {
    const [maximized, setMaximized] = useState(false);

    useEffect(() => {
        window.electronAPI?.isMaximized?.().then(setMaximized);
        const handler = (val: boolean) => setMaximized(val);
        window.electronAPI?.onMaximizeChange?.(handler);
        return () => window.electronAPI?.removeMaximizeChange?.(handler);
    }, []);

    if (!isElectron) return null;

    // macOS has native traffic light buttons — only need drag region
    if (isMac) {
        return (
            <div
                style={
                    {
                        position: "fixed",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 32,
                        WebkitAppRegion: "drag",
                        zIndex: 9999,
                    } as React.CSSProperties
                }
            />
        );
    }

    return (
        <div
            style={
                {
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 32,
                    WebkitAppRegion: "drag",
                    zIndex: 9999,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                } as React.CSSProperties
            }
        >
            <div style={{ display: "flex", WebkitAppRegion: "no-drag" } as React.CSSProperties}>
                <button onClick={() => window.electronAPI?.minimize()} title="Minimize" style={btnStyle}>
                    <MaterialMinus size="12" width="12" height="12" />
                </button>
                <button
                    onClick={() => window.electronAPI?.maximize()}
                    title={maximized ? "Restore" : "Maximize"}
                    style={btnStyle}
                >
                    {maximized ? (
                        <MaterialWindowRestore size="12" width="12" height="12" />
                    ) : (
                        <MaterialWindowMaximize size="12" width="12" height="12" />
                    )}
                </button>
                <button
                    onClick={() => window.electronAPI?.close()}
                    title="Close"
                    style={btnStyle}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#e81123")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                    <MaterialX size="12" width="12" height="12" />
                </button>
            </div>
        </div>
    );
}

const btnStyle: React.CSSProperties = {
    width: 36,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: "none",
    color: "rgba(255,255,255,0.7)",
    cursor: "pointer",
    borderRadius: 4,
};