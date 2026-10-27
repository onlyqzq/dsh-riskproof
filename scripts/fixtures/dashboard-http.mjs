// Loaded only by check:dsh in an isolated profile. It makes loopback HTTP
// requests through the real host transport, without tools or model requests.
import assert from "node:assert/strict";

export const name = "riskproof-dashboard-http-fixture";
export const inject = ["connection", "webServer"];

export function apply(ctx) {
  const connection = ctx.connection;
  const origin = `http://127.0.0.1:${ctx.webServer.port}`;
  const controller = new AbortController();
  ctx.effect(() => {
    const timer = setTimeout(() => {
      void check().catch(error => {
        // Do not include URLs, cookies, launch tokens, or response bodies.
        process.stderr.write(`RISKPROOF_HTTP_CHECK_FAILED ${error.message}\n`);
      });
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  });

  async function check() {
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const authenticated = typeof connection.authenticatedUrl === "function";
      const response = await fetch(authenticated ? connection.authenticatedUrl(origin) : origin, {
        redirect: "manual", signal: controller.signal,
      });
      assert([200, 302, 303].includes(response.status), "Host browser admission failed");
      const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
      await response.body?.cancel();
      if (authenticated) assert(cookie, "Host browser admission did not issue a cookie");

      const targets = [
        { path: "/api/riskproof/status", method: "riskproof/status" },
        { path: "/riskproof/status", method: "status" },
      ];
      const deadline = Date.now() + 7000;
      let selected;
      let lastStatus;
      while (!selected && Date.now() < deadline) {
        for (const target of targets) {
          const result = await request(target, cookie);
          lastStatus = result.status;
          if (result.status !== 200) { await result.body?.cancel(); continue; }
          const payload = await result.json();
          if (payload.type !== "server-response" || payload.rpcId !== "riskproof-http-smoke" || payload.result?.ok !== true) continue;
          assert.equal(payload.result.value?.sessionId, null, "Dashboard session isolation failed");
          assert.equal(payload.result.value?.counts?.checked, 0, "Status read created tool activity");
          assert.deepEqual(payload.result.value?.activity, [], "No-session status leaked activity");
          assert.deepEqual(payload.result.value?.risks, [], "No-session status leaked risk records");
          selected = target;
          break;
        }
        if (!selected) await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(selected, `No dashboard handler returned a valid RPC snapshot (last HTTP ${lastStatus})`);

      const crossSite = await request(selected, cookie, { origin: "https://riskproof-smoke.invalid", "sec-fetch-site": "cross-site" });
      assert.equal(crossSite.status, 403, "Host/Origin fence did not reject a cross-site request");
      await crossSite.body?.cancel();
      if (authenticated) {
        const anonymous = await request(selected, "");
        assert([401, 403].includes(anonymous.status), "Dashboard accepted a request without browser authentication");
        await anonymous.body?.cancel();
      }
      process.stderr.write(`RISKPROOF_HTTP_CHECK ${JSON.stringify({ path: selected.path, authentication: authenticated ? "browser-cookie" : "host-origin", checked: 0 })}\nRISKPROOF_INSTALL_CHECK_OK\n`);
    } finally { clearTimeout(timeout); }
  }

  function request(target, cookie, headers = {}) {
    return fetch(new URL(target.path, origin), {
      method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
      body: JSON.stringify({ type: "client-request", rpcId: "riskproof-http-smoke", method: target.method, payload: { sessionId: null } }),
    });
  }
}
