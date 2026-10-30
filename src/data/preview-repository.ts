import { emptyState } from "../domain/project.ts";
import type { ProjectRepository } from "./local-repository.ts";

/** Design-review links never read, overwrite or delete the real local project. */
export function createPreviewRepository(): ProjectRepository {
  let state = emptyState();
  return {
    load: () => ({ ok: true, value: state }),
    save: (next) => {
      state = next;
      return { ok: true, value: undefined };
    },
    clear: () => {
      state = emptyState();
      return { ok: true, value: undefined };
    },
  };
}
