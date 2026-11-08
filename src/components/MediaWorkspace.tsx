import { useEffect, useRef, useState } from "react";
import type { MediaVersion, Project } from "../domain/project";
import { formatInstant } from "../domain/project";
import { formatBytes, KIND_LABELS, withMediaVersion } from "../domain/media";
import { prepareUpload, readLocalFile, removeLocalVersion, uploadLocal } from "../data/media-store";
import type { PreparedUpload } from "../data/media-store";

export type CloudUpload = (project: Project, upload: PreparedUpload, progress: (percent: number) => void) => Promise<MediaVersion>;
function VersionThumbnail({ version, cloud }: { version: MediaVersion; cloud: boolean }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true; let objectUrl = "";
    if (!version.thumbnailKey) return;
    if (cloud) setUrl(`/api/files/${version.id}/thumbnail`);
    else void readLocalFile(version.projectId, version.thumbnailKey).then((blob) => { if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } }).catch(() => {});
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [version.id, version.projectId, version.thumbnailKey, cloud]);
  return url ? <img className="version-thumbnail" src={url} alt="" loading="lazy" width={48} height={48} /> : null;
}
export function MediaPreview({ version, cloud = false }: { version: MediaVersion; cloud?: boolean }) {
  const [url, setUrl] = useState(""); const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let active = true; let objectUrl = ""; setUrl(""); setError("");
    if (cloud) setUrl(`/api/files/${encodeURIComponent(version.id)}/${version.kind === "visual" && version.previewKey ? "preview" : "original"}`);
    else readLocalFile(version.projectId, version.previewKey ?? version.originalKey).then((blob) => {
      if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
    }).catch((cause: Error) => { if (active) setError(cause.message); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [version.id, version.projectId, version.originalKey, version.previewKey, version.kind, cloud]);
  if (error) return <p className="field-error" role="alert">{error}</p>;
  if (!url) return <p className="field-hint" role="status">파일을 불러오는 중…</p>;
  return version.kind === "music" ? <audio className="music-player" controls preload="metadata" src={url} aria-label={`${version.filename} 음악 재생`} onError={() => setError("음원을 재생하지 못했어요. 다시 접속하거나 원본 파일을 확인해주세요.")} />
    : <><button type="button" className="art-preview" aria-label={`${version.filename} 이미지 확대`} onClick={() => dialog.current?.showModal()}>
      <img src={url} alt={version.filename} onError={() => setError("이미지를 불러오지 못했어요.")} /><span>크게 보기 ↗</span>
    </button><dialog ref={dialog} className="art-dialog" aria-label="작품 확대 보기"><button type="button" className="small-button" onClick={() => dialog.current?.close()}>닫기 ×</button><img src={url} alt={version.filename} /></dialog></>;
}
interface Props { project: Project; onUpdate(change: (project: Project) => Project): boolean; cloudUpload?: CloudUpload; preview: boolean }
function FileWorkspace({ project, onUpdate, cloudUpload, preview }: Props) {
  const [stage, setStage] = useState(""); const [error, setError] = useState(""); const [file, setFile] = useState<File | null>(null);
  const [inspect, setInspect] = useState<string | null>(null); const [restore, setRestore] = useState<MediaVersion | null>(null);
  const [message, setMessage] = useState(""); const input = useRef<HTMLInputElement>(null); const busy = useRef(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const versions = project.mediaVersions ?? [];
  const current = versions.find((item) => item.id === project.currentVersionId);
  const historical = versions.find((item) => item.id === inspect);
  async function upload(chosen: File) {
    if (busy.current) return; busy.current = true; setFile(chosen); setError(""); setMessage(""); setStage("파일을 확인하고 있어요…");
    let saved: MediaVersion | undefined;
    try {
      const prepared = await prepareUpload(chosen, project);
      setStage(cloudUpload ? "비공개 서버에 올리는 중…" : "이 브라우저에 원본을 저장하는 중…");
      saved = cloudUpload ? await cloudUpload(project, prepared, (n) => setStage(`업로드 중 ${n}% · 원본 보존`)) : await uploadLocal(project, prepared);
      if (!onUpdate((latest) => withMediaVersion(latest, saved!))) {
        if (!cloudUpload && !versions.some((v) => v.id === saved!.id)) await removeLocalVersion(saved);
        throw new Error("파일 기록을 저장하지 못했어요. 현재 작업물은 유지됩니다. 다시 시도해주세요.");
      }
      setFile(null); if (input.current) input.current.value = "";
      setMessage(versions.some((v) => v.id === saved!.id) ? "이미 보관된 동일한 원본을 선택했어요." : "새 버전을 보관했어요. 원본은 변경하지 않았습니다.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "업로드하지 못했어요. 다시 시도해주세요."); }
    finally { busy.current = false; setStage(""); }
  }
  async function downloadOriginal(version: MediaVersion) {
    try {
      const href = cloudUpload ? `/api/files/${version.id}/original?download=1` : URL.createObjectURL(await readLocalFile(project.id, version.originalKey));
      const link = document.createElement("a"); link.href = href; link.download = version.filename; link.click();
      if (!cloudUpload) window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (cause) { setError((cause as Error).message); }
  }
  return <section className="creative-workspace media-workspace" aria-labelledby="workspace-heading">
    <div className="workspace-heading"><div><p className="section-label">{project.kind === "music" ? "MUSIC WORKSPACE" : "VISUAL WORKSPACE"}</p><h2 id="workspace-heading">오늘의 작은 진전</h2></div><span className="workspace-format">{KIND_LABELS[project.kind ?? "writing"]} 원본</span></div>
    <p className="workspace-intro">밖에서 만들고, 이곳에 모으세요. 새 파일을 올리면 이전 원본도 버전으로 남습니다.</p>
    {current ? <div className="current-media"><MediaPreview version={current} cloud={!!cloudUpload} /><div className="media-meta"><span>현재 작업 버전 · {formatInstant(current.createdAt)}</span><p>{current.filename} · {formatBytes(current.size)}</p><button type="button" className="text-button" onClick={() => downloadOriginal(current)}>원본 내려받기 ↗</button></div></div>
      : <div className="media-empty"><span aria-hidden="true">{project.kind === "music" ? "♫" : "▧"}</span><p>{project.kind === "music" ? "첫 멜로디를 들려주세요." : "첫 장면을 남겨주세요."}</p><small>완성 전의 데모와 스케치도 괜찮아요.</small></div>}
    <div className="file-uploader" id="workspace-content"><label htmlFor="creative-file">{current ? "수정본을 새 버전으로 보관" : "첫 원본 파일 선택"}</label>
      <input ref={input} id="creative-file" type="file" disabled={!!stage || preview} accept={project.kind === "music" ? ".mp3,audio/mpeg" : ".jpg,.jpeg,.png,image/jpeg,image/png"} onChange={(e) => { const chosen = e.target.files?.[0]; if (chosen) void upload(chosen); }} />
      <p className="field-hint">{project.kind === "music" ? "MP3 · 파일당 20MB" : "JPG / PNG · 파일당 10MB"} · 최대 50개 버전 / 원본·미리보기 합계 100MB</p>
      <p role="status" className="upload-status">{stage || message}</p>
      {preview && <p className="field-hint">디자인 미리보기에서는 파일을 저장하지 않아요. 실제 작업 주소에서 이용해주세요.</p>}
      {error && <div className="workspace-save-error" role="alert"><p>{error}</p>{file && <button type="button" className="text-button" disabled={!!stage} onClick={() => upload(file)}>같은 파일 다시 시도</button>}</div>}
    </div>
    <p className="workspace-storage-note">{cloudUpload ? "계정의 비공개 저장소에 원본과 미리보기를 따로 보관해요." : "파일은 이 브라우저의 저장소에만 보관돼요. 다른 기기에서는 계정 연결이 필요해요."} 자동 공개·판매는 아직 제공하지 않아요.</p>
    <details className="media-version-list" onToggle={(event) => setVersionsOpen(event.currentTarget.open)}><summary>보관한 버전 <span>{versions.length}개</span></summary>
      {!versions.length && <p className="field-hint">파일을 저장하면 이곳에 버전이 쌓여요.</p>}
      <ol>{[...versions].reverse().map((version) => <li key={version.id}>{versionsOpen && version.kind === "visual" && <VersionThumbnail version={version} cloud={!!cloudUpload} />}<div className="version-description"><span>{formatInstant(version.createdAt)} {version.id === current?.id && "· 현재 버전"}</span><p>{version.filename}</p></div><button className="text-button" type="button" onClick={() => setInspect(inspect === version.id ? null : version.id)}>조회</button></li>)}</ol>
      {historical && <div className="historical-media"><p className="field-hint">이전 버전 조회 · 현재 작업물은 바뀌지 않아요.</p><MediaPreview version={historical} cloud={!!cloudUpload} />{historical.id !== current?.id && <button className="small-button" type="button" onClick={() => setRestore(historical)}>이 버전을 현재 작업으로 선택</button>}</div>}
    </details>
    {restore && <div className="restore-confirm" role="group" aria-label="파일 버전 복원 확인"><p>이 버전을 현재 작업으로 선택할까요? 지금 원본과 이전 버전은 모두 남겨둡니다.</p><button type="button" className="text-button" onClick={() => setRestore(null)}>취소</button><button type="button" className="small-button" onClick={() => { if (onUpdate((p) => withMediaVersion(p, restore))) { setRestore(null); setMessage("보관된 원본을 현재 버전으로 선택했어요."); } }}>확인하고 선택</button></div>}
  </section>;
}
export function VisualWorkspace(props: Props) { return <FileWorkspace {...props} />; }
export function MusicWorkspace(props: Props) { return <FileWorkspace {...props} />; }
