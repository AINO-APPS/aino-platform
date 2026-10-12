const test = require("node:test");
const assert = require("node:assert/strict");
const { isMessageAlertState, isMessageAlertAction, messagePopupBounds } = require("../messageAlertPolicy");
const card = { conversationId: "7", messageId: "11", title: "Asha", sender: "Asha", preview: "Hello",
  avatar: "/uploads/avatar.jpg", isGroup: false, members: [], count: 1, updatedAt: 1234, replyText: "",
  draftId: "pending-1", replyOpen: false, busy: false, error: "" };
const state = { session: "account-generation", cards: [card], dark: true, primary: "#2383e2" };
test("notification IPC accepts only bounded presentation state", () => {
  assert.ok(isMessageAlertState(state));
  for (const value of [
    { ...state, cards: [card, card] },
    { ...state, cards: [{ ...card, avatar: "file:///private/file" }] },
    { ...state, cards: [{ ...card, preview: "x".repeat(201) }] },
    { ...state, cards: [{ ...card, members: [{ avatar: "javascript:alert(1)" }] }] },
    { ...state, primary: "red; background:url(secret)" },
  ]) assert.equal(isMessageAlertState(value), false);
});
test("actions must refer to a displayed conversation in the current account generation", () => {
  const action = { session: state.session, conversationId: "7", messageId: "11", action: "reply", text: "Reply" };
  assert.ok(isMessageAlertAction(action, state));
  // A newer message replaced the card after the user saw message 10.
  assert.ok(isMessageAlertAction({ ...action, messageId: "10" }, state));
  assert.equal(isMessageAlertAction({ ...action, session: "old" }, state), false);
  assert.equal(isMessageAlertAction({ ...action, messageId: "99" }, state), false);
  assert.equal(isMessageAlertAction({ ...action, conversationId: "8" }, state), false);
  assert.equal(isMessageAlertAction({ ...action, text: "x".repeat(5001) }, state), false);
  assert.equal(isMessageAlertAction({ ...action, action: "execute" }, state), false);
  assert.equal(isMessageAlertAction({ ...action, action: "draft" }, state), false);
  assert.equal(isMessageAlertAction(action, null), false);
});
test("popup uses the work area on offset secondary monitors", () => {
  const area = { x: -1920, y: 200, width: 1920, height: 1080 };
  const bounds = messagePopupBounds(area, 3);
  assert.ok(bounds.x >= area.x && bounds.x + bounds.width <= area.x + area.width);
  assert.ok(bounds.y >= area.y && bounds.y + bounds.height <= area.y + area.height);
});
