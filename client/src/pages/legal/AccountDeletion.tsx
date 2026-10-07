import { Link } from "react-router-dom";
import LegalLayout, { LEGAL_ENTITY, PRIVACY_EMAIL } from "./LegalLayout";

/** Public account-deletion instructions (Google Play "Delete account URL" requirement). */
export default function AccountDeletion() {
    return (
        <LegalLayout title="Delete your AINO account">
            <p>
                You can permanently delete your AINO account yourself, or ask us to do it.
                This page applies to the AINO Android app, the web app and the desktop app,
                provided by {LEGAL_ENTITY}.
            </p>

            <h2>Delete it in the app</h2>
            <ol>
                <li>Sign in to the AINO Android app or the web app.</li>
                <li>Open your <strong>Profile</strong> and choose <strong>Edit Profile</strong>.</li>
                <li>Tap <strong>Delete My Account</strong> and confirm with your password.</li>
            </ol>
            <p>
                If you are the only administrator of your organisation, transfer the
                administrator role to someone else first.
            </p>

            <h2>Ask us to delete it</h2>
            <p>
                If you cannot sign in, email{" "}
                <a href={`mailto:${PRIVACY_EMAIL}?subject=Account%20deletion%20request`}>{PRIVACY_EMAIL}</a>{" "}
                from your work email with the subject "Account deletion request" and the name
                of your organisation. We verify the request with you and your organisation
                and complete it within 30 days.
            </p>

            <h2>What is deleted</h2>
            <ul>
                <li>Your profile and photo, sign-in sessions and devices, and face template.</li>
                <li>Your attendance entries, leave requests and balances, and approval requests.</li>
                <li>Tasks you created or were assigned and your comments on them.</li>
                <li>Messages you sent, your notifications, reactions, read receipts, starred messages and chat and meeting memberships.</li>
            </ul>

            <h2>What may be kept</h2>
            <ul>
                <li>
                    Records your organisation must keep by law (for example payroll and
                    statutory attendance records) are kept by your organisation for the period
                    the law requires.
                </li>
                <li>Encrypted backups are overwritten in the normal backup cycle.</li>
            </ul>
            <p>
                See the <Link to="/privacy">Privacy Policy</Link> for more on how we handle
                your data.
            </p>
        </LegalLayout>
    );
}
