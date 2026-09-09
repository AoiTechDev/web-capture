import { useEffect, useState } from "react";
import { UserProfile } from "@clerk/chrome-extension";

type Progress = {
  processed: number;
  embedded: number;
  failed: number;
  remaining: number;
  done: boolean;
};

/**
 * Re-index control.
 *
 * Captures saved before local embeddings existed have no vector, so they can
 * never surface in semantic search. This walks them and fills in the vector,
 * auto-tags and source metadata.
 */
const ReindexPanel = () => {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  const refresh = () => {
    chrome.runtime.sendMessage({ type: "REINDEX_STATUS" }, (r) => {
      if (chrome.runtime.lastError || !r) return;
      setRemaining(r.remaining ?? 0);
      setRunning(!!r.running);
    });
  };

  useEffect(() => {
    refresh();
    const onMessage = (msg: any) => {
      if (msg?.type !== "REINDEX_PROGRESS") return;
      setProgress(msg.progress);
      setRunning(!msg.progress?.done);
      if (msg.progress?.done) refresh();
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const start = () => {
    setRunning(true);
    setProgress(null);
    chrome.runtime.sendMessage({ type: "REINDEX_START" }, (r) => {
      if (chrome.runtime.lastError || !r?.started) setRunning(false);
    });
  };

  return (
    <div className="plasmo-border plasmo-border-neutral-700 plasmo-rounded-lg plasmo-p-4 plasmo-mb-4">
      <h2 className="plasmo-text-sm plasmo-font-semibold plasmo-mb-1">
        Search index
      </h2>

      <p className="plasmo-text-xs plasmo-text-neutral-400 plasmo-mb-3">
        {remaining === null
          ? "Checking…"
          : remaining === 0
            ? "Everything is indexed and searchable."
            : `${remaining} capture${remaining === 1 ? "" : "s"} saved before indexing existed. They won't appear in search until re-indexed.`}
      </p>

      {progress && (
        <p className="plasmo-text-xs plasmo-text-neutral-400 plasmo-mb-3">
          {progress.done ? "Done — " : "Working — "}
          {progress.embedded} indexed
          {progress.failed > 0 && `, ${progress.failed} failed`}
          {!progress.done && progress.remaining > 0 && `, ${progress.remaining} to go`}
        </p>
      )}

      <button
        onClick={start}
        disabled={running || remaining === 0}
        className="plasmo-px-3 plasmo-py-1.5 plasmo-text-xs plasmo-rounded plasmo-bg-white plasmo-text-black disabled:plasmo-opacity-40 disabled:plasmo-cursor-not-allowed"
      >
        {running ? "Indexing…" : "Re-index library"}
      </button>

      <p className="plasmo-text-[10px] plasmo-text-neutral-500 plasmo-mt-2">
        Runs locally on your machine. No data leaves your browser except the
        vector saved to your own database. Keep this popup open to watch
        progress; indexing continues either way.
      </p>
    </div>
  );
};

export const Settings = () => {
  return (
    <>
      <h1>Settings</h1>
      <ReindexPanel />
      <UserProfile />
    </>
  );
};
