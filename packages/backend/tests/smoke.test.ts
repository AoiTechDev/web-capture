import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { makeT, userA, userB } from "./setup";

test("convex-test harness runs queries as distinct users", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    await ctx.db.insert("sessions", {
      userId: userA.subject,
      startedAt: 1,
      lastCaptureAt: 1,
      itemCount: 0,
    });
  });
  const asA = await t.withIdentity(userA).query(api.sessions.listSessions, {});
  const asB = await t.withIdentity(userB).query(api.sessions.listSessions, {});
  expect(asA.sessions.length).toBe(1);
  expect(asB.sessions.length).toBe(0);
});
