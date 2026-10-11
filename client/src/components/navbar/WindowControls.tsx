import { Minus as MaterialMinus, WindowRestore as MaterialWindowRestore, WindowMaximize as MaterialWindowMaximize, X as MaterialX } from "../../constants/icons";
import { useState, useEffect } from "react";
import s from "./WindowControls.module.css";

export default function WindowControls() {
    const [maximized, setMaximized] = useState(false);

    useEffect(() => {
        (window.electronAPI as any)?.isMaximized?.().then(setMaximized);
        const handler = (val: boolean) => setMaximized(val);
        (window.electronAPI as any)?.onMaximizeChange?.(handler);
        return () => (window.electronAPI as any)?.removeMaximizeChange?.(handler);
    }, []);

    return (
        <div className={s.controls}>
            <button
                className={s.btn}
                onClick={() => (window.electronAPI as any)?.minimize()}
                title="Minimize"
            >
                <MaterialMinus size="12" width="12" height="12" />
            </button>
            <button
                className={s.btn}
                onClick={() => (window.electronAPI as any)?.maximize()}
                title={maximized ? "Restore" : "Maximize"}
            >
                {maximized ? (
                    <MaterialWindowRestore size="12" width="12" height="12" />
                ) : (
                    <MaterialWindowMaximize size="12" width="12" height="12" />
                )}
            </button>
            <button
                className={`${s.btn} ${s.closeBtn}`}
                onClick={() => (window.electronAPI as any)?.close()}
                title="Close"
            >
                <MaterialX size="12" width="12" height="12" />
            </button>
        </div>
    );
}