import { useEffect, useRef, useState } from "react";
import type { CreativeWorkspace } from "../domain/project";
import { formatInstant, WORKSPACE_LIMIT } from "../domain/project";
import { createAutosaveController } from "../domain/autosave";
import type { SaveResult, SaveStatus } from "../domain/autosave";

interface Props {
  title: string;
  workspace?: CreativeWorkspace;
  preview: boolean;
  onSave(content: string): SaveResult;
}

export function WorkspaceEditor({ title, workspace, preview, onSave }: Props) {
  const [content, setContent] = useState(workspace?.content ?? "");
  const [status, setStatus] = useState<SaveStatus>({
    kind: workspace ? "saved" : "idle", savedAt: workspace?.updatedAt ?? "",
  });
  const saveRef = useRef(onSave);
  const mounted = useRef(false);
  const controllerRef = useRef<ReturnType<typeof createAutosaveController> | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createAutosaveController({
      content, savedAt: workspace?.updatedAt ?? "",
      save: (value) => saveRef.current(value),
      statusChanged: (value) => { if (mounted.current) setStatus(value); },
    });
  }
  const controller = controllerRef.current;
  useEffect(() => { saveRef.current = onSave; }, [onSave]);
  useEffect(() => {
    mounted.current = true;
    const visibility = () => { if (document.hidden) controller.flush(); };
    const pageHide = () => { controller.flush(); };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      controller.flush();
      if (controller.isDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      mounted.current = false;
      controller.flush();
      controller.cancel();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [controller]);

  function download() {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) || "방출-작품"}.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const statusText = status.kind === "pending" ? "저장 중…"
    : status.kind === "error" ? "저장하지 못했어요"
    : status.kind === "saved" ? (preview ? "미리보기에 반영됨 · 저장되지 않음" : "이 브라우저에 저장됨")
    : "첫 문장부터 시작해보세요";

  return (
    <section className="creative-workspace" aria-labelledby="workspace-heading">
      <div className="workspace-heading">
        <div><p className="section-label">CREATIVE WORKSPACE</p><h2 id="workspace-heading">오늘의 작은 진전</h2></div>
        <span className="workspace-format">텍스트 원본</span>
      </div>
      <p className="workspace-intro" id="workspace-help">작품을 쓰고, 고치고, 이어가세요. 마지막 입력 후 자동으로 저장합니다.</p>
      <label className="sr-only" htmlFor="workspace-content">작품 본문</label>
      <textarea
        id="workspace-content" className="workspace-editor" value={content}
        maxLength={WORKSPACE_LIMIT} spellCheck={false}
        placeholder={"아직 다듬지 않은 첫 문장도 괜찮아요.\n이곳에서 작품을 이어가세요."}
        aria-describedby="workspace-help workspace-storage-note"
        onChange={(event) => { setContent(event.target.value); controller.edit(event.target.value); }}
        onCompositionStart={() => controller.compositionStart()}
        onCompositionEnd={(event) => { setContent(event.currentTarget.value); controller.compositionEnd(event.currentTarget.value); }}
        onBlur={() => controller.flush()}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault(); controller.flush();
          }
        }}
      />
      <div className="workspace-save-row">
        <div className="workspace-save-status" data-status={status.kind} role="status" aria-live="polite">
          <span className="save-dot" aria-hidden="true" />
          <span>{statusText}</span>
        </div>
        <span className="workspace-character-count">{content.length.toLocaleString()}자</span>
      </div>
      <div className="workspace-footnotes">
        <p>{status.savedAt ? `마지막 수정 · ${formatInstant(status.savedAt)}` : "아직 저장된 본문이 없습니다."}</p>
        <button type="button" className="text-button" onClick={download}>본문 내려받기 <span aria-hidden="true">↓</span></button>
      </div>
      {status.kind === "error" && <div className="workspace-save-error" role="alert">
        <p>{status.error} 창을 닫기 전에 다시 저장하거나 본문을 내려받아 보관해주세요.</p>
        <button type="button" className="small-button" onClick={() => controller.flush()}>본문 저장 다시 시도</button>
      </div>}
      <p className="workspace-storage-note" id="workspace-storage-note">
        {preview ? "디자인 미리보기입니다. 입력은 새로고침하면 사라집니다." : "이 브라우저에만 저장됩니다. 다른 기기와 동기화되지 않으며, 브라우저 데이터를 지우면 사라질 수 있어요."}
        <br />예정일이 지나도 자동으로 공개되지 않습니다.
      </p>
    </section>
  );
}
