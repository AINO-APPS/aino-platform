# 27: iOS Tasks webview and session exchange

**What to build:** iOS gains the Tasks area. It opens already signed in through a single-use, short-lived session exchange: the native client presents its token, receives a code, and the webview redeems it for a normal session. The token never enters the web page. Leaving and returning keeps the session.

**Blocked by:** 07, 20

**Status:** ready-for-agent

- [ ] The Tasks area is reachable from iOS and renders backlog, board, plan and schedule
- [ ] The webview opens already authenticated with no visible handoff
- [ ] The exchange code is single-use and expires within sixty seconds
- [ ] The bearer token is never exposed to JavaScript in the webview
- [ ] Redeeming a code from a native client is rejected
- [ ] The session survives leaving and returning to the Tasks area
- [ ] A configuration surface that is web-only deep-links to web rather than half-working
