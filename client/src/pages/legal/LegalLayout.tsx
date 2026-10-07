import type { ReactNode } from "react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import s from "./LegalPage.module.css";

export const LEGAL_ENTITY = "AINO Technologies Pvt Ltd";
export const PRIVACY_EMAIL = "privacy@aino.org.in";
export const LEGAL_UPDATED = "7 October 2026";

/** Shared shell for the public, unauthenticated legal pages (Play Store requires stable URLs). */
export default function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
    useEffect(() => {
        const previous = document.title;
        document.title = `${title} · AINO`;
        return () => { document.title = previous; };
    }, [title]);

    return (
        <div className={s.page}>
            <div className={s.shell}>
                <header className={s.header}>
                    <Link to="/login" className={s.brand}>AINO</Link>
                    <nav className={s.nav} aria-label="Legal">
                        <Link to="/privacy">Privacy Policy</Link>
                        <Link to="/terms">Terms of Service</Link>
                        <Link to="/account-deletion">Delete your account</Link>
                    </nav>
                </header>
                <article className={s.article}>
                    <h1>{title}</h1>
                    <p className={s.updated}>Last updated: {LEGAL_UPDATED}</p>
                    {children}
                </article>
            </div>
        </div>
    );
}
