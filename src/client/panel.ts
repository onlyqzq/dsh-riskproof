import type { Dashboard } from "../experience/dashboard.js";
import type { ClientContext } from "./context.js";
import { createPanelView, type CommandCopy } from "./view.js";

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
  let commandCopy: CommandCopy | undefined;
  let copyRequest = 0;
  const targets = [["/api", "riskproof/status"], ["/riskproof", "status"]] as const;
  let targetIndex = 0;
  let nextFallbackAt = 0;

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
    view.render({ current, data, connected, loading, pulseUntil, reconnecting: !!controller, commandCopy });
  }

  async function readDashboard(requested: string | null, request: AbortController, version: number): Promise<Dashboard> {
    const attempt = async (index: number) => {
      const [channel, endpoint] = targets[index];
      const response = await ctx.connection.rpc.call(channel, endpoint, { sessionId: requested }, request.signal);
      request.signal.throwIfAborted();
      if (!response.ok || !response.value || typeof response.value !== "object") throw new Error("unavailable");
      const snapshot = response.value as Dashboard;
      if (snapshot.sessionId !== requested || !snapshot.counts || !Array.isArray(snapshot.risks)) throw new Error("invalid snapshot");
      return snapshot;
    };
    try {
      return await attempt(targetIndex);
    } catch (error) {
      if (disposed || generation !== version || request.signal.aborted || Date.now() < nextFallbackAt) throw error;
      // Older hosts only expose the dedicated channel. Remember a working route;
      // outages may retry discovery at most once per 30 seconds, never each poll.
      nextFallbackAt = Date.now() + 30_000;
      const alternate = 1 - targetIndex;
      const snapshot = await attempt(alternate);
      targetIndex = alternate;
      return snapshot;
    }
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
      const next = await readDashboard(requested, request, version);
      if (disposed || generation !== version) return;
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
    const snapshot = ctx.sessions.list.getSnapshot();
    const mainViews = Object.values(snapshot.byId ?? {}).filter(row => (row.retainedBy?.mainView ?? 0) > 0);
    // DSH 0.2 moved selection out of list.current; mainView ownership is the
    // public catalog fact used by its own Session UI. Never retain/open a session.
    const id = snapshot.current ?? mainViews.find(row => row.id === current)?.id ?? mainViews[0]?.id ?? null;
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
    commandCopy = undefined;
    copyRequest++;
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
  retry.addEventListener("click", () => { nextFallbackAt = 0; void refresh(); });
  for (const command of ["demo", "doctor"] as const) {
    find<HTMLButtonElement>(`.rp-copy[data-command="${command}"]`).addEventListener("click", async () => {
      if (disposed || !current || !connected || !data?.proofEnabled || data.counts.checked) return;
      const request = ++copyRequest;
      commandCopy = { command, result: "copying" };
      render();
      try {
        if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
        await navigator.clipboard.writeText(`/riskproof ${command}`);
        if (disposed || request !== copyRequest) return;
        commandCopy = { command, result: "copied" };
      } catch {
        if (disposed || request !== copyRequest) return;
        commandCopy = { command, result: "manual" };
      }
      render();
    });
  }

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
