export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export type AutosavePersistResult =
  | { ok: true }
  | { ok: false; error: string; field?: string };

export type AutosaveState = {
  status: AutosaveStatus;
  error: string | null;
  field?: string;
};

export const AUTOSAVE_DEBOUNCE_MS = 700;
export const AUTOSAVE_SAVED_HOLD_MS = 2500;

export const IDLE_AUTOSAVE: AutosaveState = { status: "idle", error: null };

const STATUS_RANK: Record<AutosaveStatus, number> = {
  idle: 0,
  saved: 1,
  dirty: 2,
  saving: 3,
  error: 4,
};

export function autosaveStatusText(state: AutosaveState): string | null {
  switch (state.status) {
    case "idle":
    case "dirty":
      return null;
    case "saving":
      return "Sparar…";
    case "saved":
      return "✓ Sparat";
    case "error":
      return state.field ? "Kunde inte spara alla ändringar" : (state.error ?? "Kunde inte spara");
  }
}

export function mergeAutosaveStates(...states: AutosaveState[]): AutosaveState {
  return states.reduce((best, next) => (STATUS_RANK[next.status] > STATUS_RANK[best.status] ? next : best));
}

export type AutosaveTimers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

export type AutosaveLoop = {
  notify: (key: string, persist: () => Promise<AutosavePersistResult>) => void;
  flush: () => Promise<boolean>;
  dispose: () => void;
  getState: () => AutosaveState;
};

export function createAutosaveLoop(options: {
  debounceMs?: number;
  savedHoldMs?: number;
  timers?: AutosaveTimers;
  onState: (state: AutosaveState) => void;
}): AutosaveLoop {
  const debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
  const savedHoldMs = options.savedHoldMs ?? AUTOSAVE_SAVED_HOLD_MS;
  const setTimeoutFn = options.timers?.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearTimeoutFn =
    options.timers?.clearTimeout ?? ((id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>));

  let state: AutosaveState = { ...IDLE_AUTOSAVE };
  let currentKey = "";
  let savedKey = "";
  let persistFn: (() => Promise<AutosavePersistResult>) | null = null;
  let debounceHandle: unknown = null;
  let fadeHandle: unknown = null;
  let generation = 0;
  let inFlight: Promise<void> | null = null;
  let disposed = false;

  function emit(next: AutosaveState) {
    state = next;
    if (!disposed) options.onState(state);
  }

  function clearDebounce() {
    if (debounceHandle != null) {
      clearTimeoutFn(debounceHandle);
      debounceHandle = null;
    }
  }

  function clearFade() {
    if (fadeHandle != null) {
      clearTimeoutFn(fadeHandle);
      fadeHandle = null;
    }
  }

  function scheduleFade() {
    clearFade();
    fadeHandle = setTimeoutFn(() => {
      fadeHandle = null;
      if (state.status === "saved") emit({ ...IDLE_AUTOSAVE });
    }, savedHoldMs);
  }

  function scheduleRun() {
    clearDebounce();
    debounceHandle = setTimeoutFn(() => {
      debounceHandle = null;
      void run();
    }, debounceMs);
  }

  function notify(key: string, persist: () => Promise<AutosavePersistResult>) {
    if (disposed) return;
    currentKey = key;
    persistFn = persist;
    generation += 1;
    clearFade();

    if (key === savedKey && state.status !== "error") {
      clearDebounce();
      if (state.status === "saving") return;
      if (state.status === "saved") return;
      emit({ ...IDLE_AUTOSAVE });
      return;
    }

    if (state.status === "saving") return;

    emit({ status: "dirty", error: null });
    scheduleRun();
  }

  async function run(): Promise<void> {
    if (disposed || !persistFn) return;
    if (currentKey === savedKey && state.status !== "error") return;
    if (inFlight) {
      await inFlight;
      if (disposed) return;
      if (currentKey === savedKey && state.status !== "error") return;
    }

    const gen = generation;
    const key = currentKey;
    const persist = persistFn;
    emit({ status: "saving", error: null });

    const work = (async () => {
      const result = await persist();
      if (disposed) return;
      if (gen !== generation) {
        void run();
        return;
      }
      if (result.ok) {
        savedKey = key;
        emit({ status: "saved", error: null });
        scheduleFade();
        return;
      }
      emit({
        status: "error",
        error: result.error,
        field: result.field,
      });
    })();

    inFlight = work.finally(() => {
      if (inFlight === work) inFlight = null;
    });
    await work;
  }

  async function flush(): Promise<boolean> {
    if (disposed) return state.status !== "error";
    clearDebounce();
    if (inFlight) await inFlight;
    if (disposed) return state.status !== "error";
    if (currentKey !== savedKey || state.status === "error") {
      await run();
    }
    return state.status !== "error" && currentKey === savedKey;
  }

  return {
    notify,
    flush,
    dispose() {
      disposed = true;
      clearDebounce();
      clearFade();
    },
    getState: () => state,
  };
}
