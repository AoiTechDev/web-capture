/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "../convex/schema";

// Every Convex module, so convex-test can resolve `api.*` / `internal.*`.
export const modules = import.meta.glob("../convex/**/!(*.*.*)*.*s");

export function makeT() {
  return convexTest(schema, modules);
}

export const userA = { subject: "user_a", tokenIdentifier: "test|user_a" };
export const userB = { subject: "user_b", tokenIdentifier: "test|user_b" };
