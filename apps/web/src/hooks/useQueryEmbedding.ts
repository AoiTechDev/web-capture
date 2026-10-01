import { useCallback, useSyncExternalStore } from "react";
import {
  createQueryEmbedder,
  getExtensionSendMessage,
  type ModelStatus,
  type QueryEmbedder,
} from "@/lib/extension-embed";

/**
 * Module-level, like useStableQuery's cache: the vector cache and the model
 * status outlive a remount, so leaving the dashboard and coming back neither
 * re-asks the extension nor shows "Loading search model…" again.
 */
let embedder: QueryEmbedder | null = null;
const listeners = new Set<() => void>();

function getEmbedder(): QueryEmbedder {
  embedder ??= createQueryEmbedder({
    // The installed extension's ID (chrome://extensions); it is fixed by the
    // manifest `key`, so one value serves every install of a given build.
    extensionId: process.env.NEXT_PUBLIC_EXTENSION_ID,
    sendMessage: getExtensionSendMessage(),
    onStatus: () => listeners.forEach((l) => l()),
  });
  return embedder;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Query vectors from the Chrome extension's local model, for hybrid search.
 * `embed` resolves to null (search by keyword only) when the extension is
 * missing or too slow; `status` says why, for the one-time loading note.
 */
export function useQueryEmbedding(): {
  embed: (query: string) => Promise<number[] | null>;
  status: ModelStatus;
} {
  const status = useSyncExternalStore(
    subscribe,
    () => getEmbedder().status,
    // Server render: nothing asked yet.
    () => "idle" as ModelStatus
  );
  const embed = useCallback((query: string) => getEmbedder().embed(query), []);
  return { embed, status };
}
