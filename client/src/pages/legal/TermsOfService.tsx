import { Link } from "react-router-dom";
import LegalLayout, { LEGAL_ENTITY, PRIVACY_EMAIL } from "./LegalLayout";

/** Public end-user terms. The customer agreement with each organisation takes precedence. */
export default function TermsOfService() {
    return (
        <LegalLayout title="Terms of Service">
            <p>
                These terms apply when you use the AINO web, desktop or Android apps provided
                by {LEGAL_ENTITY} ("AINO"). Your organisation gives you access to AINO under a
                separate agreement with us; if these terms conflict with that agreement, the
                agreement applies.
            </p>

            <h2>1. Your account</h2>
            <ul>
                <li>Your organisation creates and manages your account and can suspend or remove it.</li>
                <li>Keep your password and devices secure and tell your administrator if you suspect misuse.</li>
                <li>You must be at least 18 years old.</li>
            </ul>

            <h2>2. Acceptable use</h2>
            <p>Do not use AINO to:</p>
            <ul>
                <li>break the law or your organisation's policies;</li>
                <li>upload malware or content you have no right to share;</li>
                <li>falsify attendance, location or identity;</li>
                <li>harass others or send spam;</li>
                <li>try to access data or accounts you are not authorised to use, or disrupt the service.</li>
            </ul>

            <h2>3. Your content</h2>
            <p>
                Content you create belongs to you or your organisation as agreed between you.
                You allow AINO to store and process it only to provide the service. How we
                handle personal data is described in the <Link to="/privacy">Privacy Policy</Link>.
            </p>

            <h2>4. The service</h2>
            <p>
                We work to keep AINO available and secure but provide it "as is" to end users.
                Features depend on your organisation's plan and settings and may change. We
                may update the apps; some updates may be required to keep using the service.
            </p>

            <h2>5. Liability</h2>
            <p>
                To the extent permitted by law, AINO is not liable to end users for indirect or
                consequential loss. Our responsibilities to your organisation are set out in
                its agreement with us.
            </p>

            <h2>6. Ending use</h2>
            <p>
                You can stop using AINO at any time and may delete your account as described
                on the <Link to="/account-deletion">account deletion page</Link>. Your access
                ends if your organisation removes your account or stops using AINO.
            </p>

            <h2>7. Governing law</h2>
            <p>These terms are governed by the laws of India.</p>

            <h2>8. Contact</h2>
            <p>
                <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>
            </p>
        </LegalLayout>
    );
}
