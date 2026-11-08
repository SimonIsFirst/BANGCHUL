import type { LocalState, MediaVersion, Project } from "../domain/project";
import { isLocalState } from "./local-repository.ts";
import type { ProjectRepository, StoragePort } from "./local-repository";
import type { PreparedUpload } from "./media-store";
export interface CloudSnapshot { state: LocalState; revision: number }
export type SyncStatus = { kind: "saved" | "pending" | "error"; message: string };
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
  const value = await response.json().catch(() => ({ error: "서버 응답을 확인하지 못했어요." }));
  if (!response.ok) throw new Error(value.error || "계정 저장소에 연결하지 못했어요.");
  return value as T;
}
export function createCloudRepository(userId: string, remote: CloudSnapshot, storage: StoragePort, send = (project: Project, revision: number) => api<{ revision: number }>("/api/project", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project, revision }) })) {
  const key = `bangchul:account:v2:${encodeURIComponent(userId)}`;
  let current = remote.state; let revision = remote.revision; let pending = false; let conflict = false;
  let timer: ReturnType<typeof setTimeout> | undefined; let inFlight: Promise<void> | null = null;
  let status: SyncStatus = { kind: "saved", message: "서버의 최신 기록을 불러왔어요." };
  let loadError = "";
  const listeners = new Set<() => void>();
  try {
    const raw = storage.getItem(key);
    if (raw) {
      const cached = JSON.parse(raw);
      if (!isLocalState(cached.state) || !Number.isSafeInteger(cached.revision) || typeof cached.pending !== "boolean") throw new Error();
      if (cached.pending) { current = cached.state; revision = cached.revision; pending = true;
        conflict = revision !== remote.revision;
        status = conflict ? { kind: "error", message: "다른 기기의 변경과 저장 대기 중인 원고가 있어요. 현재 내용을 내려받고 서버 기록을 별도로 확인해주세요. 자동으로 덮어쓰지 않습니다." } : { kind: "pending", message: "이 기기의 저장 대기 내용을 서버에 연결하고 있어요." };
      }
    }
  } catch { loadError = "이 계정의 기기 백업을 읽지 못했어요. 백업을 덮어쓰지 않았습니다."; status = { kind: "error", message: loadError }; }
  function notify(next: SyncStatus) { status = next; listeners.forEach((listener) => listener()); }
  function cache() { storage.setItem(key, JSON.stringify({ state: current, revision, pending })); }
  async function flush(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (inFlight) return inFlight;
    if (loadError) throw new Error(loadError);
    if (conflict) throw new Error(status.message);
    inFlight = (async () => {
      while (pending) {
        const snapshot = current;
        if (!snapshot.project) { pending = false; cache(); notify({ kind: "saved", message: "프로젝트를 만들면 계정에 비공개로 저장됩니다." }); break; }
        notify({ kind: "pending", message: "서버에 비공개로 저장 중…" });
        try {
          const result = await send(snapshot.project, revision);
          if (!Number.isSafeInteger(result.revision) || result.revision !== revision + 1) throw new Error("서버 저장 결과를 확인하지 못했어요.");
          revision = result.revision; pending = current !== snapshot; cache();
          if (!pending) notify({ kind: "saved", message: "모든 변경 사항이 서버에 저장됐어요." });
        } catch (cause) { notify({ kind: "error", message: `${(cause as Error).message} 기기 백업과 현재 입력은 유지됩니다.` }); throw cause; }
      }
    })();
    try { await inFlight; } finally { inFlight = null; }
  }
  function schedule() { if (timer) clearTimeout(timer); timer = setTimeout(() => { void flush().catch(() => {}); }, 1500); }
  const repository: ProjectRepository = {
    load: () => loadError ? { ok: false, error: loadError } : { ok: true, value: current },
    save(next) {
      if (loadError) return { ok: false, error: loadError };
      const before = current; const previousPending = pending;
      current = next; pending = true;
      try { cache(); } catch { current = before; pending = previousPending; return { ok: false, error: "기기 백업을 저장하지 못했어요. 본문을 내려받고 저장 공간을 확인해주세요." }; }
      notify({ kind: conflict ? "error" : "pending", message: conflict ? status.message : "기기에 임시 보관됨 · 서버 저장 대기 중" });
      if (!conflict) schedule();
      return { ok: true, value: undefined };
    },
    clear: () => ({ ok: false, error: "계정 프로젝트는 이 화면에서 삭제하지 않아요. 브라우저 기록은 그대로 보존됩니다." }),
  };
  if (pending && !conflict) schedule();
  async function replaceFromServer(load: () => Promise<CloudSnapshot>) {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (inFlight) await inFlight.catch(() => {});
    const latest = await load();
    if (!isLocalState(latest.state) || !Number.isSafeInteger(latest.revision)) throw new Error("서버 기록을 검증하지 못했어요.");
    const raw = storage.getItem(key);
    if (raw) {
      const backupKey = `${key}:protected:${crypto.randomUUID()}`;
      storage.setItem(backupKey, raw);
      if (storage.getItem(backupKey) !== raw) throw new Error("현재 기기 백업을 보호하지 못했어요. 작업 공간은 유지됩니다.");
    }
    storage.setItem(key, JSON.stringify({ state: latest.state, revision: latest.revision, pending: false }));
    return createCloudRepository(userId, latest, storage, send);
  }
  return { id: crypto.randomUUID(), repository, flush, getStatus: () => status, hasPending: () => pending,
    replaceFromServer,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { if (timer) clearTimeout(timer); listeners.clear(); },
  };
}
export type CloudRepository = ReturnType<typeof createCloudRepository>;
export async function uploadCloud(project: Project, upload: PreparedUpload, progress: (percent: number) => void): Promise<MediaVersion> {
  const form = new FormData(); form.append("original", upload.original);
  if (upload.preview) form.append("preview", upload.preview, "preview.webp");
  if (upload.thumbnail) form.append("thumbnail", upload.thumbnail, "thumbnail.webp");
  return await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open("POST", `/api/projects/${encodeURIComponent(project.id)}/files`); xhr.responseType = "json"; xhr.timeout = 120_000;
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 && xhr.response?.version ? resolve(xhr.response.version) : reject(new Error(xhr.response?.error || "파일을 올리지 못했어요. 다시 시도해주세요."));
    xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(new Error("연결이 끊겼거나 업로드 시간이 초과됐어요. 같은 파일로 다시 시도해주세요."));
    xhr.send(form);
  });
}
