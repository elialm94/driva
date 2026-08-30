process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_SAVED_HOLD_MS,
  autosaveStatusText,
  createAutosaveLoop,
  mergeAutosaveStates,
  type AutosavePersistResult,
  type AutosaveState,
} from "./autosave";

function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++;
      tasks.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(handle: unknown) {
      tasks.delete(handle as number);
    },
    advance(ms: number) {
      now += ms;
      const due = [...tasks.entries()]
        .filter(([, task]) => task.at <= now)
        .sort((a, b) => a[1].at - b[1].at);
      for (const [id, task] of due) {
        tasks.delete(id);
        task.fn();
      }
    },
  };
}

async function microtasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function trackLoop(persist: () => Promise<AutosavePersistResult> = async () => ({ ok: true })) {
  const timers = createFakeTimers();
  const states: AutosaveState[] = [];
  let latest: string | null = null;
  const loop = createAutosaveLoop({
    timers,
    onState: (state) => {
      states.push(state);
    },
  });
  return {
    timers,
    states,
    loop,
    persist,
    type(key: string, nextPersist = persist) {
      latest = key;
      loop.notify(key, () => nextPersist());
    },
    latest: () => latest,
  };
}

describe("autosaveStatusText", () => {
  it("visar inte dirty eller idle", () => {
    assert.equal(autosaveStatusText({ status: "idle", error: null }), null);
    assert.equal(autosaveStatusText({ status: "dirty", error: null }), null);
  });

  it("har text för saving, saved och error", () => {
    assert.equal(autosaveStatusText({ status: "saving", error: null }), "Sparar…");
    assert.equal(autosaveStatusText({ status: "saved", error: null }), "✓ Sparat");
    assert.equal(autosaveStatusText({ status: "error", error: null }), "Kunde inte spara");
    assert.equal(
      autosaveStatusText({ status: "error", error: "Ange e-postadressen som namn@exempel.se.", field: "email" }),
      "Kunde inte spara alla ändringar"
    );
  });
});

describe("mergeAutosaveStates", () => {
  it("låter error vinna över saving, dirty och saved", () => {
    const merged = mergeAutosaveStates(
      { status: "saved", error: null },
      { status: "saving", error: null },
      { status: "error", error: "Kunde inte spara", field: "email" }
    );
    assert.equal(merged.status, "error");
    assert.equal(merged.field, "email");
  });
});

describe("createAutosaveLoop", () => {
  it("väntar ut debounce innan persist, sedan Sparar… → Sparat", async () => {
    let calls = 0;
    const session = trackLoop(async () => {
      calls += 1;
      return { ok: true };
    });
    session.type("Sara Andersson");
    assert.equal(session.loop.getState().status, "dirty");
    session.timers.advance(AUTOSAVE_DEBOUNCE_MS - 1);
    await microtasks();
    assert.equal(calls, 0);
    session.timers.advance(1);
    await microtasks();
    assert.equal(calls, 1);
    assert.equal(session.loop.getState().status, "saved");
    assert.equal(autosaveStatusText(session.loop.getState()), "✓ Sparat");
  });

  it("flushar utan att vänta på debounce", async () => {
    let calls = 0;
    const session = trackLoop(async () => {
      calls += 1;
      return { ok: true };
    });
    session.type("nytt namn");
    const ok = await session.loop.flush();
    assert.equal(ok, true);
    assert.equal(calls, 1);
    assert.equal(session.loop.getState().status, "saved");
  });

  it("håller latest key vid fel – markerar inte Sparat och återställer inte", async () => {
    const session = trackLoop(async () => ({
      ok: false,
      error: "Ange e-postadressen som namn@exempel.se.",
      field: "email",
    }));
    session.type("sara@");
    session.timers.advance(AUTOSAVE_DEBOUNCE_MS);
    await microtasks();
    assert.equal(session.loop.getState().status, "error");
    assert.equal(session.loop.getState().field, "email");
    assert.equal(session.latest(), "sara@");
    assert.equal(autosaveStatusText(session.loop.getState()), "Kunde inte spara alla ändringar");
  });

  it("retry efter fel sparar latest och går till Sparat", async () => {
    let fail = true;
    const session = trackLoop(async () => {
      if (fail) return { ok: false, error: "Nätverket strulade" };
      return { ok: true };
    });
    session.type("Sara Andersson");
    session.timers.advance(AUTOSAVE_DEBOUNCE_MS);
    await microtasks();
    assert.equal(session.loop.getState().status, "error");
    fail = false;
    const ok = await session.loop.flush();
    assert.equal(ok, true);
    assert.equal(session.loop.getState().status, "saved");
  });

  it("snabba ändringar blir en persist av senaste värdet", async () => {
    const keys: string[] = [];
    const session = trackLoop(async () => {
      keys.push(session.latest() ?? "");
      return { ok: true };
    });
    session.type("S");
    session.timers.advance(200);
    session.type("Sa");
    session.timers.advance(200);
    session.type("Sara Andersson");
    session.timers.advance(AUTOSAVE_DEBOUNCE_MS);
    await microtasks();
    assert.deepEqual(keys, ["Sara Andersson"]);
    assert.equal(session.loop.getState().status, "saved");
  });

  it("ignorerar inaktuell success när en nyare ändring kommit in", async () => {
    const first = {
      resolve: (_result: AutosavePersistResult) => {
        /* set when first persist starts */
      },
    };
    let calls = 0;
    const session = trackLoop();
    session.type("Sara A", () => {
      calls += 1;
      return new Promise<AutosavePersistResult>((resolve) => {
        first.resolve = resolve;
      });
    });
    session.timers.advance(AUTOSAVE_DEBOUNCE_MS);
    await microtasks();
    assert.equal(session.loop.getState().status, "saving");

    session.type("Sara Andersson", async () => {
      calls += 1;
      return { ok: true };
    });
    assert.equal(session.loop.getState().status, "saving");
    first.resolve({ ok: true });
    await microtasks();
    await microtasks();
    assert.equal(calls, 2);
    assert.equal(session.loop.getState().status, "saved");
  });

  it("låter Sparat tona bort till idle", async () => {
    const session = trackLoop();
    session.type("Sara Andersson");
    session.timers.advance(AUTOSAVE_DEBOUNCE_MS);
    await microtasks();
    assert.equal(session.loop.getState().status, "saved");
    session.timers.advance(AUTOSAVE_SAVED_HOLD_MS);
    assert.equal(session.loop.getState().status, "idle");
  });
});
