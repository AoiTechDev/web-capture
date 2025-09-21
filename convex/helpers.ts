import { type Infer } from "convex/values";
import { captureValidator } from "./schema";

export type Capture = Infer<typeof captureValidator>;
