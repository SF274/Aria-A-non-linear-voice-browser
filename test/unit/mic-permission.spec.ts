/**
 * Microphone permission flow unit tests — SPEC §6.2, §10.2
 *
 * Mocks chrome.storage.local, chrome.tabs, and chrome.runtime.
 * Tests the ensureMicPermission() and resetMicGranted() helpers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state — NOT reset between tests (state is module-level)
// ---------------------------------------------------------------------------

const localStore: Record<string, unknown> = {};

// Tab close listener registry — persists across vi.clearAllMocks()
// because we register it once using addListener on the stable object.
const tabCloseListeners: Array<(tabId: number) => void> = [];
let tabIdCounter = 1000;
let createdTabUrl: string | null = null;

// We do NOT use vi.clearAllMocks() because that would wipe the mock
// implementations. Instead we reset state manually in beforeEach.

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: localStore[key] })),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        Object.assign(localStore, obj);
      }),
    },
    session: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
    },
  },
  tabs: {
    create: vi.fn(async ({ url }: { url: string }) => {
      createdTabUrl = url;
      const id = ++tabIdCounter;
      return { id };
    }),
    onRemoved: {
      addListener: vi.fn((cb: (tabId: number) => void) => {
        tabCloseListeners.push(cb);
      }),
      removeListener: vi.fn((cb: (tabId: number) => void) => {
        const idx = tabCloseListeners.indexOf(cb);
        if (idx >= 0) tabCloseListeners.splice(idx, 1);
      }),
    },
  },
  runtime: {
    getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`),
    sendMessage: vi.fn().mockResolvedValue({}),
  },
  offscreen: null,
};

vi.stubGlobal("chrome", chromeMock);

// ---------------------------------------------------------------------------
// Import AFTER mocking so the module captures the mock chrome.
// ---------------------------------------------------------------------------

import { ensureMicPermission, resetMicGranted } from "../../src/sw/mic";

// ---------------------------------------------------------------------------
// Helper: simulate tab close event (writes granted/denied to storage first).
// ---------------------------------------------------------------------------

async function closeTab(tabId: number, granted: boolean): Promise<void> {
  // The permission page writes to storage before closing.
  localStore["micGranted"] = granted;
  // Fire all currently registered close listeners synchronously.
  const listeners = [...tabCloseListeners];
  tabCloseListeners.length = 0;
  for (const listener of listeners) {
    listener(tabId);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Microphone permission flow (SPEC §6.2, §10.2)", () => {
  beforeEach(() => {
    // Reset data — but keep mock implementations intact.
    for (const key of Object.keys(localStore)) delete localStore[key];
    tabCloseListeners.length = 0;
    createdTabUrl = null;
    chromeMock.tabs.create.mockClear();
    chromeMock.storage.local.get.mockClear();
    chromeMock.storage.local.set.mockClear();
  });

  // -------------------------------------------------------------------------
  // Fast path — already granted
  // -------------------------------------------------------------------------

  it("returns true immediately when micGranted is already true", async () => {
    localStore["micGranted"] = true;
    const result = await ensureMicPermission();
    expect(result).toBe(true);
    expect(chromeMock.tabs.create).not.toHaveBeenCalled();
  });

  it("does not re-open permission.html on a second call after grant", async () => {
    localStore["micGranted"] = true;
    await ensureMicPermission();
    await ensureMicPermission();
    expect(chromeMock.tabs.create).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // resetMicGranted
  // -------------------------------------------------------------------------

  it("resetMicGranted() writes micGranted: false to storage", async () => {
    localStore["micGranted"] = true;
    await resetMicGranted();
    expect(localStore["micGranted"]).toBe(false);
  });

  it("resetMicGranted() works even when micGranted was not previously set", async () => {
    await resetMicGranted();
    expect(localStore["micGranted"]).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Grant flow — uses a concurrently-resolved promise to simulate tab close.
  // -------------------------------------------------------------------------

  it("opens permission.html tab when micGranted is false, returns true on grant", async () => {
    localStore["micGranted"] = false;

    // Start the async flow — it will pause at waitForTabClose.
    const permissionPromise = ensureMicPermission();

    // Yield to allow ensureMicPermission to call chrome.tabs.create and
    // register the onRemoved listener.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Verify a tab was created before simulating close.
    expect(chromeMock.tabs.create).toHaveBeenCalledOnce();
    const lastTabId = tabIdCounter;

    // Simulate user granting access and the tab closing.
    await closeTab(lastTabId, true);

    const result = await permissionPromise;
    expect(result).toBe(true);
    expect(createdTabUrl).toContain("permission.html");
  });

  it("returns false when the user denies (micGranted stays false after tab close)", async () => {
    localStore["micGranted"] = false;

    const permissionPromise = ensureMicPermission();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const lastTabId = tabIdCounter;
    // Simulate denial — micGranted remains false.
    await closeTab(lastTabId, false);

    const result = await permissionPromise;
    expect(result).toBe(false);
  });

  it("opens permission.html when micGranted is absent (undefined), returns true on grant", async () => {
    // micGranted not set at all.
    const permissionPromise = ensureMicPermission();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const lastTabId = tabIdCounter;
    await closeTab(lastTabId, true);

    const result = await permissionPromise;
    expect(result).toBe(true);
    expect(chromeMock.tabs.create).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // URL shape
  // -------------------------------------------------------------------------

  it("opens the tab with the extension origin URL for permission.html", async () => {
    localStore["micGranted"] = false;

    const permissionPromise = ensureMicPermission();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const lastTabId = tabIdCounter;
    await closeTab(lastTabId, true);
    await permissionPromise;

    expect(createdTabUrl).toMatch(/chrome-extension:\/\/[^/]+\/src\/pages\/permission\.html/);
  });
});
