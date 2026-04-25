"use client";

// Offline-tolerant progress updates. Each book has one latest position; we
// overwrite in a localStorage-backed queue and drain on reconnect.

import { apiFetch } from "@/lib/csrf-client";

const BP = "/Reader";
const STORAGE_KEY = "reader:progress-queue";

type Entry = {
  bookId: string;
  chapter_idx: number;
  paragraph_idx: number;
  ts: number;
};

type Queue = Record<string, Entry>;

function read(): Queue {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Queue;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function write(q: Queue): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(q));
  } catch {
    /* quota exceeded — ignore */
  }
}

function enqueue(entry: Entry): void {
  const q = read();
  q[entry.bookId] = entry;
  write(q);
}

function remove(bookId: string, ts: number): void {
  const q = read();
  // Only remove if it's still the same entry we drained. If the user
  // advanced the position during the POST, the newer ts must stay queued.
  if (q[bookId] && q[bookId].ts === ts) {
    delete q[bookId];
    write(q);
  }
}

async function postEntry(entry: Entry): Promise<boolean> {
  try {
    const res = await apiFetch(`${BP}/api/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: entry.bookId,
        chapter_idx: entry.chapter_idx,
        paragraph_idx: entry.paragraph_idx,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

let draining = false;

export async function drainProgressQueue(): Promise<void> {
  if (draining) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  draining = true;
  try {
    const q = read();
    const entries = Object.values(q);
    for (const entry of entries) {
      const ok = await postEntry(entry);
      if (!ok) break; // stop on first failure; retry on next trigger
      remove(entry.bookId, entry.ts);
    }
  } finally {
    draining = false;
  }
}

/**
 * Send a progress update. Attempts immediately; on network failure queues
 * for later. Safe to call every ~800ms from the Reader's progress effect —
 * later calls for the same book overwrite earlier queued entries.
 */
export function sendProgress(args: {
  bookId: string;
  chapter_idx: number;
  paragraph_idx: number;
}): void {
  const entry: Entry = { ...args, ts: Date.now() };
  enqueue(entry);
  void drainProgressQueue();
}

let wired = false;

/** Attach one-time window listeners that drain the queue when we come back. */
export function attachProgressDrainer(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  const kick = () => void drainProgressQueue();
  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") kick();
  });
  // Initial attempt on load (covers the case where the user navigated offline
  // earlier in the same tab, then came back online before any event fired).
  kick();
}
