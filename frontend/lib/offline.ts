"use client";

type CachedEnvelope<T> = {
  data: T;
  updated_at: string;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function readCached<T>(key: string): CachedEnvelope<T> | null {
  if (!canUseStorage()) {
    return null;
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as CachedEnvelope<T>;
  } catch {
    return null;
  }
}

export function writeCached<T>(key: string, data: T): void {
  if (!canUseStorage()) {
    return;
  }
  const envelope: CachedEnvelope<T> = {
    data,
    updated_at: new Date().toISOString(),
  };
  window.localStorage.setItem(key, JSON.stringify(envelope));
}

export function readQueue<T>(key: string): T[] {
  if (!canUseStorage()) {
    return [];
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeQueue<T>(key: string, queue: T[]): void {
  if (!canUseStorage()) {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(queue));
}

export function appendQueueItem<T>(key: string, item: T): T[] {
  const queue = readQueue<T>(key);
  const updated = [...queue, item];
  writeQueue(key, updated);
  return updated;
}
