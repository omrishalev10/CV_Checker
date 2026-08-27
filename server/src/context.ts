import { AsyncLocalStorage } from "node:async_hooks";

interface RequestUser {
  userId: number;
  username: string;
}

const als = new AsyncLocalStorage<RequestUser>();

export function runWithUser<T>(user: RequestUser, fn: () => T): T {
  return als.run(user, fn);
}

export function currentUserId(): number {
  const store = als.getStore();
  if (!store) throw new Error("No signed-in user in this request.");
  return store.userId;
}

export function currentUsername(): string | null {
  return als.getStore()?.username ?? null;
}

export function tryCurrentUserId(): number | null {
  return als.getStore()?.userId ?? null;
}
