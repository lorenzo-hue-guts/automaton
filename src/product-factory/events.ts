import { monotonicFactory } from "ulid";
import type { ProductFactoryStore } from "./store.js";
import type { FactoryEvent } from "./types.js";
const nextEventId = monotonicFactory();

/** Persistent audit record, not a second scheduler or message bus. */
export function appendFactoryEvent(store: ProductFactoryStore, input: Omit<FactoryEvent, "id" | "createdAt">): FactoryEvent {
  const event: FactoryEvent = { ...input, id: nextEventId(), createdAt: new Date().toISOString() };
  store.insert("events", event);
  return event;
}
