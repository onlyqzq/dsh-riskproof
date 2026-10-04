import type { Dashboard } from "../experience/dashboard.js";
import type { ClientContext } from "./context.js";
import { createPanelView } from "./view.js";

export const inject = ["commandUi", "sessions", "connection"];

/** Coordinates polling, session changes, panel interactions, and disposal. */
export function apply(ctx: ClientContext): void {
  const view = createPanelView();
  const { root, style, panel, beacon, retry, find } = view;
  let current: string | null = null;
  let data: Dashboard | undefined;
  let connected = false;
  let loading = true;
  let disposed = false;
  let controller: AbortController | undefined;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pulseUntil = 0;
  let lastId: string | undefined;

  const setOpen = (open: boolean, restoreFocus = true) => {
    panel.hidden = !open;
    beacon.setAttribute("aria-expanded", String(open));
    if (open) {
      find<HTMLButtonElement>(".rp-close").focus();
      void refresh();
    } else {
      find(".rp-details pre").textContent = "";
      find<HTMLElement>(".rp-details").hidden = true;
      find(".rp-details").removeAttribute("open");
      if (restoreFocus) beacon.focus();
    }
  };

  function render() {
    view.render({ current, data, connected, loading, pulseUntil, reconnecting: !!controller });
  }

  async function refresh() {
    if (disposed || document.hidden || controller) return;
    const version = generation;
    const requested = current;
    const request = new AbortController();
    controller = request;
    if (!connected) render();
    const timeout = setTimeout(() => request.abort(), 4000);
    try {
      const response = await ctx.connection.rpc.call("/riskproof", "status", { sessionId: requested }, request.signal);
      if (disposed || generation !== version) return;
      if (!response.ok || !response.value || typeof response.value !== "object") {
        throw new Error("unavailable");
      }
      const next = response.value as Dashboard;
      if (next.sessionId !== requested || !next.counts || !Array.isArray(next.risks)) {
        throw new Error("invalid snapshot");
      }
      const latest = next.activity.at(-1)?.id;
      if (connected && latest && latest !== lastId) {
        pulseUntil = Date.now() + 1600;
      }
      lastId = latest;
      data = next;
      connected = true;
    } catch {
      if (!disposed && generation === version) {
        connected = false;
        data = undefined;
        lastId = undefined;
        pulseUntil = 0;
      }
    } finally {
      clearTimeout(timeout);
      if (generation === version) loading = false;
      if (controller === request) controller = undefined;
      if (!disposed) render();
    }
  }

  const selection = () => {
    const id = ctx.sessions.list.getSnapshot().current ?? null;
    if (id === current) return;
    generation++;
    controller?.abort();
    controller = undefined;
    current = id;
    data = undefined;
    connected = false;
    loading = true;
    pulseUntil = 0;
    lastId = undefined;
    find(".rp-details pre").textContent = "";
    find<HTMLElement>(".rp-details").hidden = true;
    find(".rp-details").removeAttribute("open");
    render();
    void refresh();
  };

  const visibility = () => {
    if (!document.hidden) void refresh();
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !panel.hidden) setOpen(false);
  };

  const outside = (event: PointerEvent) => {
    if (!panel.hidden && event.target instanceof Node && !root.contains(event.target)) {
      setOpen(false, false);
    }
  };
  beacon.addEventListener("click", () => setOpen(panel.hidden));
  find(".rp-close").addEventListener("click", () => setOpen(false));
  retry.addEventListener("click", () => { void refresh(); });

  ctx.effect(() => {
    document.head.append(style);
    document.body.append(root);
    const unsubscribe = ctx.sessions.list.subscribe(selection);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    const tick = async () => {
      await refresh();
      if (!disposed) timer = setTimeout(tick, 1000);
    };
    selection();
    render();
    void tick();
    return () => {
      disposed = true;
      generation++;
      controller?.abort();
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
      root.remove();
      style.remove();
    };
  });

  ctx.on("command/executed", (...args) => {
    const [sessionId, name, result] = args;
    if (name !== "riskproof" || sessionId !== current) return;
    // Commands remain a secondary entry; ordinary calls never open the panel.
    setOpen(true);
    if (result && typeof result === "object" && "text" in result && typeof result.text === "string") {
      find(".rp-details pre").textContent = result.text.slice(0, 48000);
      find<HTMLElement>(".rp-details").hidden = false;
    }
  });
}
