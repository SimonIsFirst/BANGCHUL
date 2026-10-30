import {
  DESCRIPTION_LIMIT,
  emptyState,
  NAME_LIMIT,
  NOTE_LIMIT,
  parseLocalDate,
  STEPS,
  TITLE_LIMIT,
  WORKSPACE_LIMIT,
} from "../domain/project.ts";
import type { Draft, LocalState, Note, Project } from "../domain/project.ts";

export const STORAGE_KEY = "bangchul:mvp:v1";
export type RepositoryResult<T> =
  { ok: true; value: T } | { ok: false; error: string };
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ProjectRepository {
  load(): RepositoryResult<LocalState>;
  save(state: LocalState): RepositoryResult<void>;
  clear(): RepositoryResult<void>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number, required = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    (!required || value.trim().length > 0)
  );
}

function instant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validDraft(value: unknown): value is Draft {
  return (
    record(value) &&
    text(value.name, NAME_LIMIT) &&
    text(value.title, TITLE_LIMIT) &&
    text(value.description, DESCRIPTION_LIMIT) &&
    typeof value.agreed === "boolean" &&
    (value.startDate === undefined ||
      value.startDate === "" ||
      (typeof value.startDate === "string" &&
        parseLocalDate(value.startDate) !== null)) &&
    (value.releaseDate === "" ||
      (typeof value.releaseDate === "string" &&
        parseLocalDate(value.releaseDate) !== null))
  );
}

function validNote(value: unknown): value is Note {
  return (
    record(value) &&
    text(value.id, 100, true) &&
    text(value.text, NOTE_LIMIT, true) &&
    instant(value.createdAt)
  );
}

function validProject(value: unknown): value is Project {
  if (
    !record(value) ||
    !text(value.id, 100, true) ||
    !text(value.name, NAME_LIMIT, true) ||
    !text(value.title, TITLE_LIMIT, true) ||
    !text(value.description, DESCRIPTION_LIMIT, true) ||
    typeof value.releaseDate !== "string" ||
    !parseLocalDate(value.releaseDate) ||
    (value.startDate !== undefined &&
      (typeof value.startDate !== "string" ||
        !parseLocalDate(value.startDate))) ||
    !instant(value.startedAt) ||
    !instant(value.releaseAt) ||
    !instant(value.updatedAt) ||
    !text(value.timeZone, 100, true) ||
    !Array.isArray(value.notes) ||
    !value.notes.every(validNote) ||
    (value.workspace !== undefined && !validWorkspace(value.workspace)) ||
    (value.history !== undefined && !validHistory(value.history))
  )
    return false;
  try {
    new Intl.DateTimeFormat("ko-KR", { timeZone: value.timeZone });
  } catch {
    return false;
  }
  return true;
}

function validWorkspace(value: unknown): boolean {
  return record(value) && text(value.content, WORKSPACE_LIMIT) && instant(value.updatedAt);
}

function validHistory(value: unknown): boolean {
  return record(value) && Object.entries(value).every(([date, snapshot]) =>
    parseLocalDate(date) !== null && record(snapshot) && snapshot.date === date &&
    text(snapshot.content, WORKSPACE_LIMIT) && instant(snapshot.savedAt),
  );
}

export function isLocalState(value: unknown): value is LocalState {
  return (
    record(value) &&
    value.version === 1 &&
    validDraft(value.draft) &&
    typeof value.step === "string" &&
    (value.step === "opening" ||
      STEPS.includes(value.step as (typeof STEPS)[number])) &&
    (value.project === null || validProject(value.project))
  );
}

/** All browser persistence stays behind this port for a later server adapter. */
export function createLocalRepository(
  getStorage: () => StoragePort,
): ProjectRepository {
  return {
    load() {
      let raw: string | null;
      try {
        raw = getStorage().getItem(STORAGE_KEY);
      } catch {
        return {
          ok: false,
          error:
            "브라우저 저장소에 접근하지 못했어요. 사이트의 저장 권한을 확인한 뒤 다시 시도해주세요.",
        };
      }
      if (raw === null) return { ok: true, value: emptyState() };
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!isLocalState(parsed)) throw new Error("Invalid saved data");
        return { ok: true, value: parsed };
      } catch {
        // Never silently overwrite saved data from a different version or damaged JSON.
        return {
          ok: false,
          error:
            "저장된 내용을 읽지 못했어요. 기존 데이터는 그대로 보관되어 있어요. 다시 시도하거나, 확인 후 이 체험 데이터를 초기화해주세요.",
        };
      }
    },
    save(state) {
      try {
        getStorage().setItem(STORAGE_KEY, JSON.stringify(state));
        return { ok: true, value: undefined };
      } catch {
        return {
          ok: false,
          error:
            "브라우저에 저장하지 못했어요. 저장 공간이나 사이트 권한을 확인하고 다시 시도해주세요. 화면의 입력 내용은 유지됩니다.",
        };
      }
    },
    clear() {
      try {
        getStorage().removeItem(STORAGE_KEY);
        return { ok: true, value: undefined };
      } catch {
        return {
          ok: false,
          error:
            "저장된 내용을 초기화하지 못했어요. 브라우저의 저장 권한을 확인해주세요.",
        };
      }
    },
  };
}

export const localRepository = createLocalRepository(() => window.localStorage);
