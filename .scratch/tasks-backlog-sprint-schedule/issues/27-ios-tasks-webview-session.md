# 27: iOS Tasks webview and session exchange

**What to build:** iOS gains the Tasks area. It opens already signed in through a single-use, short-lived session exchange: the native client presents its token, receives a code, and the webview redeems it for a normal session. The token never enters the web page. Leaving and returning keeps the session.

**Blocked by:** 07, 20

**Status:** done

- [x] The Tasks area is reachable from iOS and renders backlog, board, plan and schedule
- [x] The webview opens already authenticated with no visible handoff
- [x] The exchange code is single-use and expires within sixty seconds
- [x] The bearer token is never exposed to JavaScript in the webview
- [x] Redeeming a code from a native client is rejected
- [x] The session survives leaving and returning to the Tasks area
- [x] A configuration surface that is web-only deep-links to web rather than half-working

## Comments

- `services/webviewSession.ts` owns the exchange. A native client presents its
  bearer token to `POST /api/auth/webview/code` and receives a code that lives
  for sixty seconds; the webview redeems it at `POST /api/auth/webview/session`
  for a normal HttpOnly cookie session.
- The code is single-use: redemption is an atomic
  `UPDATE … WHERE consumed_at IS NULL AND expires_at > NOW()`, so two concurrent
  redemptions cannot both succeed. A replay, an expiry or a claim mismatch
  returns `null`.
- The bearer token never enters the web page. The code is a JWT carrying only
  `{ jti, user_id, tenant_id, realm, issued_to }` — a test decodes the payload
  and asserts no token field exists — and it travels in the URL fragment, which
  is never sent to the server and never appears in a `Referer`.
- A native client cannot redeem a code: `consumeWebviewCode` refuses anything
  whose `presented_by` is not `webview`, and the route defaults to `webview`
  only for a browser. A code also cannot cross realms.
- `routes/auth/webview.ts` holds the two routes, mounted inside the auth router
  so the cookie-mirroring wrapper and the realm-aware cookie name apply
  unchanged. Extracting them kept `routes/auth.ts` under its ratchet.
- iOS: `WebviewSession.swift` (code model, exchange, URL builder),
  `TasksWebView.swift` (the `WKWebView` plus its view model) and
  `TasksEntryView.swift` (wiring). The webview uses the default data store, so
  the session cookie survives leaving and returning to the area; `updateUIView`
  only reloads when the target actually changed.
- Backlog, board, plan and schedule are all reachable (`TasksWebRoute`). A
  web-only configuration surface (`/agile-settings`) is handed to the system
  browser rather than rendered half-working in-app.
- `TasksWebViewTests` covers the sixty-second cap, the fragment-not-query rule,
  every Tasks route, the web-only deep link, and that the exchange sends the
  client name and no token in the body.