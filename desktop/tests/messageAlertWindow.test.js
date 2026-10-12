const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");

test("popup lifecycle keeps ownership checks, never steals focus, and clears on logout/reload/quit", () => {
  const windows = [];
  class FakeWindow extends EventEmitter {
    constructor(options = {}) {
      super();
      this.options = options;
      this.destroyed = false;
      this.messages = [];
      this.shown = 0;
      this.webContents = new EventEmitter();
      this.webContents.send = (...args) => this.messages.push(args);
      this.webContents.setWindowOpenHandler = () => {};
      windows.push(this);
    }
    getBounds() { return { x: -1920, y: 0, width: 900, height: 800 }; }
    setBounds(bounds) { this.bounds = bounds; }
    isDestroyed() { return this.destroyed; }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    showInactive() { this.shown++; }
    show() { assert.fail("A message notification must not steal focus"); }
    focus() { assert.fail("A message notification must not focus the main app"); }
    destroy() { this.destroyed = true; this.emit("closed"); }
  }
  const app = new EventEmitter();
  const handlers = new Map();
  const electron = { app, BrowserWindow: FakeWindow, screen: {
    getDisplayMatching: () => ({ workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }),
  }, ipcMain: { on: (name, handler) => handlers.set(name, handler) }, shell: { openExternal: async () => {} } };
  const originalLoad = Module._load;
  try {
    Module._load = function (request, ...args) { return request === "electron" ? electron : originalLoad.call(this, request, ...args); };
    const { setupMessageAlertWindow } = require("../messageAlertWindow");
    const main = new FakeWindow();
    setupMessageAlertWindow(main, "https://example.test", async () => {});
    function send(name, window, payload) {
      const frame = { url: "workpulse://app/message-popup" };
      frame.top = frame;
      handlers.get(name)({ sender: window.webContents, senderFrame: frame }, payload);
    }
    const card = { conversationId: "7", messageId: "11", title: "Asha", sender: "Asha", preview: "Hello",
      avatar: null, isGroup: false, members: [], count: 1, updatedAt: 1234, replyText: "", draftId: "pending-1",
      replyOpen: false, busy: false, error: "" };
    const state = { session: "session-1", cards: [card], dark: true, primary: "#2383e2" };
    send("messages:publish", main, state);
    const popup = windows[1];
    assert.equal(popup.options.webPreferences.sandbox, true);
    assert.equal(popup.options.webPreferences.nodeIntegration, false);
    assert.equal(popup.shown, 0);
    send("messages:ready", main); // Wrong renderer cannot complete readiness.
    assert.equal(popup.shown, 0);
    send("messages:ready", popup);
    assert.equal(popup.shown, 1);
    assert.deepEqual(popup.messages[0], ["messages:state", state]);
    send("messages:resize", popup, 220);
    assert.equal(popup.bounds.height, 220);
    assert.equal(popup.bounds.y + popup.bounds.height, 1064);
    const action = { session: state.session, conversationId: "7", messageId: "11", action: "reply", text: "Hello" };
    send("messages:action", popup, action);
    assert.deepEqual(main.messages.at(-1), ["messages:action", action]);
    const count = main.messages.length;
    const oldWarn = console.warn;
    try {
      console.warn = () => {};
      send("messages:action", main, action);
      send("messages:action", popup, { ...action, session: "old-account" });
      send("messages:publish", popup, state);
    } finally { console.warn = oldWarn; }
    assert.equal(main.messages.length, count);
    send("messages:clear", popup);
    assert.equal(popup.isDestroyed(), false);
    send("messages:clear", main);
    assert.equal(popup.isDestroyed(), true);
    send("messages:publish", main, state);
    main.webContents.emit("did-start-loading");
    assert.equal(windows.at(-1).isDestroyed(), true);
    send("messages:publish", main, state);
    app.emit("before-quit");
    assert.equal(windows.at(-1).isDestroyed(), true);
  } finally { Module._load = originalLoad; }
});
