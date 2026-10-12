# AINO desktop message alerts

The existing Electron app shows AINO-styled message popups above other apps
while the main window is minimized or hidden in the tray. Closing the main
window hides it; choosing **Quit** stops delivery. The browser version uses the
same cards inside its page, with a permission-based background browser alert
that opens the conversation when clicked.

## Actions and behavior

- A simple card: conversation avatar, name, text or attachment preview, a close
  button, and **Reply** / **Mark as read**. Clicking the card opens the
  conversation; muting stays in the chat itself.
- Replies use the existing authenticated HTTP endpoint, honour group posting
  rules and recipients' mutes, and reuse an idempotency key when the same text
  is retried. Errors keep the draft and offer retry.
- Drafts stay inside the popup card, so typing is not sent over IPC on every
  keystroke. Actions apply to the message the user saw, even if a newer
  message arrives before the click.
- Messages coalesce by conversation. At most three cards appear on desktop and
  one compact card above the mobile tab bar; remaining conversations wait in
  memory. Hover, keyboard focus, a draft or an action error pauses automatic
  dismissal.
- An actually visible/focused chat, muted conversation, or AINO Do Not Disturb
  does not produce a message alert. Dismissing a card does not mark it read.
  Mark-read targets the displayed message cursor, not messages arriving later.
  Returning to a visible chat marks it read only when it has unread messages.
- A mention plays the chosen mention tone instead of the message tone.
- Profile **Notification Sounds** exposes message popup enablement and hidden
  previews, alongside existing tones and volumes. Hidden previews remove names,
  photos and message content before notification-window IPC or browser display.
  Sound-only master mute remains independent of popup enablement.
- Early messages wait for canonical preferences, so a slow settings request
  cannot briefly expose previews before the privacy flag is known. Failed
  settings loads are reported once and retried on network recovery or focus.
- Logout/account changes clear queued cards, drafts and browser/native windows.

## Boundaries

These are Teams-inspired interactions, not full Microsoft Teams parity.
There is no new closed-app push service, Windows Action Center inline-reply
integration, enterprise priority contacts, or message history stored in the popup.
Browser/OS notifications do not support arbitrary inline reply; open the app
or use the in-page card instead.

Custom Electron windows do not inherit Windows Focus Assist filtering.
Use AINO Do Not Disturb or disable message popups when interruptions are
unwanted. Alerts do not activate/focus the main window; choosing **Open chat**
does.

## Implementation and verification

- The app-wide client owner consumes existing deduplicated realtime events,
  rather than depending on the chat page.
- `messageAlertWindow.ts` owns a sandboxed, context-isolated secondary window.
  Only the main renderer may publish state; only the owned popup may request
  actions. IDs, account generations, text lengths and displayed conversations
  are checked before action forwarding.
- The popup gets presentation state, not credentials or unrestricted API access.
  Authenticated replies/read/mute execute in the main renderer.
- `npm run build:main` generates the tracked desktop JavaScript.
- `node --test tests/messageAlertPolicy.test.js tests/messageAlertWindow.test.js
  tests/ipcContract.test.js` covers payload limits, sender ownership, lifecycle,
  sizing and non-activating display. The repository root IPC guard also checks
  that the preload, types and channel manifest remain aligned.

Real OS focus/tray behavior still deserves a packaged desktop smoke test;
browser fixtures are not a substitute for that check.
