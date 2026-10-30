export type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string };
export type SaveStatus = {
  kind: "idle" | "pending" | "saved" | "error";
  savedAt: string;
  error?: string;
};

type Schedule = (callback: () => void, milliseconds: number) => () => void;
interface Options {
  content: string;
  savedAt: string;
  save(content: string): SaveResult;
  statusChanged(status: SaveStatus): void;
  schedule?: Schedule;
}

/** Sync persistence + an injectable clock make debounce and failed writes testable. */
export function createAutosaveController(options: Options) {
  let content = options.content;
  let savedContent = content;
  let savedAt = options.savedAt;
  let cancelPending: (() => void) | undefined;
  let composing = false;
  const schedule: Schedule = options.schedule ?? ((callback, delay) => {
    const timeout = setTimeout(callback, delay);
    return () => clearTimeout(timeout);
  });

  function cancel() {
    cancelPending?.();
    cancelPending = undefined;
  }
  function unchanged() {
    options.statusChanged({ kind: savedAt ? "saved" : "idle", savedAt });
  }
  function flush(): boolean {
    cancel();
    if (content === savedContent) {
      unchanged();
      return true;
    }
    let result: SaveResult;
    try {
      result = options.save(content);
    } catch {
      result = { ok: false, error: "저장하지 못했어요. 작성한 내용은 이 화면에 유지됩니다." };
    }
    if (!result.ok) {
      options.statusChanged({ kind: "error", savedAt, error: result.error });
      return false;
    }
    savedContent = content;
    savedAt = result.savedAt;
    options.statusChanged({ kind: "saved", savedAt });
    return true;
  }
  function edit(next: string) {
    cancel();
    content = next;
    if (content === savedContent) return unchanged();
    options.statusChanged({ kind: "pending", savedAt });
    if (!composing) cancelPending = schedule(flush, 750);
  }
  return {
    edit,
    flush,
    cancel,
    isDirty: () => content !== savedContent,
    compositionStart() { composing = true; cancel(); },
    compositionEnd(next: string) { composing = false; edit(next); },
  };
}
