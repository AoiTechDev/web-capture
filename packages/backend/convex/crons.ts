import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * Keep the library counters complete without anyone running a command:
 * starts the user_stats backfill on a new deployment, recounts after the
 * counting rule changes, and resumes a walk that stalled. A single read
 * when there is nothing to do.
 */
crons.interval("library counters", { minutes: 10 }, internal.user_stats.backfillUserStats, {});

export default crons;
