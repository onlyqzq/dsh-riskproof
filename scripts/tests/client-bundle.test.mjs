import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";

// Exercise the actual publishable artifact: source imports alone cannot detect
// a missing dependency in the host's module-loader bundle.
test("browser bundle loads, renders safe metadata, switches sessions and disposes", async (t) => {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  let registration;
  window.__ModuleLoader__ = { load: (module) => { registration = module; } };
  window.eval(readFileSync(new URL("../../dist/client.js", import.meta.url), "utf8"));
  assert.equal(registration.id, "dsh-riskproof");
  const plugin = registration.factory();
  assert.deepEqual(Array.from(plugin.inject), ["commandUi", "sessions", "connection"]);

  const snapshot = {
    sessionId: "first",
    language: "en",
    health: { attention: 1, checks: [{ id: 'credential-output', status: 'attention', title: 'Credential output protection', detail: 'API_KEY is not blocked', action: 'Review output.blockedTaints' }], note: 'Read-only configuration checks' },
    mode: "enforce",
    taskMode: "standard",
    proofEnabled: true,
    partial: false,
    limit: 500,
    counts: { checked: 1, clear: 0, blocked: 1, attention: 0, succeeded: 0, pending: 0 },
    activity: [{ id: "proof", kind: "blocked", tool: "send_email", at: "now" }],
    risks: [{
      id: "proof", tool: "send_email", sources: ["read_file"],
      title: "<img src=x onerror=alert(1)>", rule: "credential_external_action",
      remediation: "Verify the command source",
      outcome: "已阻止执行", kind: "blocked",
    }],
  };
  let current = "first";
  let selection;
  let cleanup;
  let unsubscribed = false;
  const events = new Map();
  plugin.apply({
    sessions: { list: {
      getSnapshot: () => ({ current }),
      subscribe: (callback) => {
        selection = callback;
        return () => { unsubscribed = true; };
      },
    } },
    connection: { rpc: { call: async (channel, endpoint, payload) => {
      assert.equal(channel, "/riskproof");
      assert.equal(endpoint, "status");
      return { ok: true, value: { ...snapshot, sessionId: payload.sessionId } };
    } } },
    on: (event, callback) => events.set(event, callback),
    effect: (callback) => { cleanup = callback(); },
  });
  t.after(() => cleanup?.());
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const find = (selector) => window.document.querySelector(selector);
  await settle();
  assert.equal(find(".rp-root").dataset.state, "blocked");
  assert.equal(find(".rp-root").lang, "en");
  assert.equal(find(".rp-title").textContent, "Conversation security overview");
  assert.match(find(".rp-beacon").getAttribute("aria-label"), /Blocked 1 risky calls/);
  assert.equal(find(".rp-panel").hidden, true);
  assert.equal(find(".rp-count-blocked").textContent, "1");
  assert.equal(find(".rp-health").hidden, false);
  assert.equal(find(".rp-health").hasAttribute("open"), false);
  assert.match(find(".rp-checks").textContent, /API_KEY is not blocked/);
  assert.equal(find(".rp-remediation").textContent, "Verify the command source");
  assert.equal(find(".rp-flow").textContent, "read_file→send_email");
  assert.equal(find("img"), null);
  assert.match(find(".rp-risk-title").textContent, /<img/);
  assert.match(find(".rp-style").textContent, /\.rp-beacon/);

  events.get("command/executed")("first", "riskproof", { text: "receipt" });
  assert.equal(find(".rp-panel").hidden, false);
  assert.equal(find(".rp-details pre").textContent, "receipt");
  current = "second";
  selection();
  assert.equal(find(".rp-details pre").textContent, "");
  assert.equal(find(".rp-data").hidden, true);
  await settle();
  assert.equal(find(".rp-data").hidden, false);
  cleanup();
  cleanup = undefined;
  assert.equal(unsubscribed, true);
  assert.equal(find(".rp-root"), null);
  assert.equal(find(".rp-style"), null);
});
