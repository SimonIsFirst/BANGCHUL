import type { Project } from "../domain/project.ts";
import { mappedImport, sameImportedProject } from "../domain/import-plan.ts";
import type { ImportPlan } from "../domain/import-plan.ts";
import type { CloudSnapshot } from "./cloud-repository.ts";
import type { MediaVersion } from "../domain/project.ts";
export interface ImportPorts {
  start(source: Project): Promise<ImportPlan>;
  upload(source: Project, version: MediaVersion): Promise<MediaVersion>;
  complete(id: string): Promise<CloudSnapshot>;
  read(): Promise<CloudSnapshot>;
}
/** The server keeps the original plan; each retry skips verified, already readable files. */
export async function importProject(source: Project, ports: ImportPorts, progress: (message: string) => void) {
  const job = await ports.start(source); const originals = job.source.mediaVersions ?? [];
  if (job.status === "complete") {
    const latest = await ports.read();
    if (latest.importing || latest.state.project?.id !== job.source.id) throw new Error("가져온 프로젝트를 확인하지 못했어요.");
    progress("이미 가져온 계정 기록을 열었어요."); return latest;
  }
  const files = [...job.files]; let done = 0;
  for (const version of originals) {
    if (!files.some((v) => v.sha256 === version.sha256 && v.size === version.size && v.mime === version.mime)) {
      progress(`원본 가져오는 중 · ${done}/${originals.length}개 완료`);
      const uploaded = await ports.upload(job.source, version);
      if (uploaded.sha256 !== version.sha256 || uploaded.size !== version.size || uploaded.mime !== version.mime || uploaded.projectId !== job.source.id) throw new Error("원본 검증에 실패했어요. 브라우저 원본은 유지됩니다.");
      files.push(uploaded);
    }
    done++; progress(`원본 가져오는 중 · ${done}/${originals.length}개 완료`);
  }
  progress("모든 원본과 기록을 연결하는 중…"); await ports.complete(job.id);
  const verified = await ports.read();
  if (verified.importing || !sameImportedProject(verified.state.project, mappedImport(job.source, files))) throw new Error("가져온 기록의 검증을 완료하지 못했어요. 다시 가져오기를 선택해주세요.");
  progress("프로젝트와 원본 복사를 확인했어요."); return verified;
}
