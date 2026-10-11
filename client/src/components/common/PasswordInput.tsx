import { EyeOff as MaterialEyeOff, Eye as MaterialEye } from "../../constants/icons";
import React, { useState } from "react";
import s from "./PasswordInput.module.css";

interface PasswordInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    className?: string;
    style?: React.CSSProperties;
}

/**
 * Drop-in replacement for <input type="password">.
 * Forwards all standard input props; adds an eye toggle.
 */
export default function PasswordInput({ className = "", style, ...props }: PasswordInputProps) {
    const [show, setShow] = useState(false);

    return (
        <div className={`${s.wrapper} ${className}`} style={style}>
            <input {...props} type={show ? "text" : "password"} className={s.input} />
            <button
                type="button"
                className={s.toggle}
                onClick={() => setShow((v) => !v)}
                tabIndex={-1}
                aria-label={show ? "Hide password" : "Show password"}
            >
                {show ? (
                    /* Eye-off */
                    <MaterialEyeOff size="16" width="16" height="16" />
                ) : (
                    /* Eye */
                    <MaterialEye size="16" width="16" height="16" />
                )}
            </button>
        </div>
    );
}