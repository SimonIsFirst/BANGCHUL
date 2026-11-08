import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { localRepository } from "./data/local-repository";
import type { ProjectRepository } from "./data/local-repository";
import { api, createCloudRepository, uploadCloud } from "./data/cloud-repository";
import type { CloudRepository, CloudSnapshot } from "./data/cloud-repository";
import { readLocalFile } from "./data/media-store";
import { AccountControls } from "./components/AccountControls";
import type { AccountSession } from "./components/AccountControls";
import { createPreviewRepository } from "./data/preview-repository";
import { nextScene, ONBOARDING_SCENES, previousScene, readExperience, withAccountMode } from "./domain/experience";
import {
  createProject,
  emptyState,
  localDate,
  STEPS,
  validateStep,
} from "./domain/project";
import type { Draft, LocalState, Project } from "./domain/project";
import { ProjectDashboard } from "./components/ProjectDashboard";
import { ResetDialog } from "./components/ResetDialog";
import { OnboardingScene } from "./components/OnboardingScene";
import { Arrow } from "./components/Arrow";
import { DoorSmoke } from "./components/DoorSmoke";
import { withWorkspaceContent } from "./domain/workspace";
import type { SaveResult } from "./domain/autosave";
import "./App.css";
import "./workspace.css";
import "./multimedia.css";

const SCENE_NAMES = {
  opening: "OPENING",
  name: "NAME",
  title: "PROJECT",
  description: "DESCRIPTION",
  transition: "NEXT CHAPTER",
  deadline: "PERIOD",
  agreement: "AGREEMENT",
  dashboard: "MY PROJECT",
  "storage-error": "LOCAL DATA",
};

function Application({ repository: selectedRepository, cloud, accountControls, switching }: { repository?: ProjectRepository; cloud: CloudRepository | null; accountControls: ReactNode; switching: boolean }) {
  const [experience] = useState(() => readExperience(window.location.search));
  const [repository] = useState(() => experience.preview ? createPreviewRepository() : selectedRepository ?? localRepository);
  const [initial] = useState(() => repository.load());
  const [state, setState] = useState<LocalState>(() =>
    initial.ok ? initial.value : emptyState(),
  );
  const stateRef = useRef(state);
  const [blocked, setBlocked] = useState(!initial.ok);
  const [storageError, setStorageError] = useState(
    initial.ok ? "" : initial.error,
  );
  const [fieldError, setFieldError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [smokePaused, setSmokePaused] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const scene = blocked
    ? "storage-error"
    : state.project
      ? "dashboard"
      : state.step;
  const sceneNumber = ONBOARDING_SCENES.indexOf(state.step) + 1;
  const sceneCount = ONBOARDING_SCENES.length;

  useEffect(() => {
    const refresh = () => setNow(new Date());
    const interval = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [scene]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function setCurrentState(next: LocalState) {
    stateRef.current = next;
    setState(next);
  }
  function save(next: LocalState, keepInputOnFailure = false): boolean {
    if (blocked) return false;
    const result = repository.save(next);
    if (!result.ok) {
      setStorageError(result.error);
      if (keepInputOnFailure) setCurrentState(next);
      return false;
    }
    setCurrentState(next);
    setStorageError("");
    return true;
  }
  function updateDraft(patch: Partial<Draft>) {
    const draft = { ...state.draft, ...patch };
    if (!("agreed" in patch)) draft.agreed = false;
    save({ ...state, draft }, true);
    setFieldError("");
  }
  function goTo(step: LocalState["step"]) {
    const draft =
      step === "deadline" && !state.draft.startDate
        ? { ...state.draft, startDate: localDate() }
        : state.draft;
    save({ ...state, draft, step }, true);
    setFieldError("");
  }
  function next(event: FormEvent) {
    event.preventDefault();
    if (state.step === "opening") return;
    const error = validateStep(state.step, state.draft);
    if (error) {
      setFieldError(error);
      return;
    }
    if (state.step === "agreement") {
      const invalid = STEPS.find((item) => validateStep(item, state.draft));
      if (invalid) {
        goTo(invalid);
        setFieldError(validateStep(invalid, state.draft)!);
        return;
      }
      if (save({ ...emptyState(), project: createProject(state.draft) }))
        setNotice(experience.preview ? "미리보기 프로젝트를 만들었어요. 입력은 저장되지 않습니다." : cloud ? "계정 프로젝트를 만들었어요. 서버 저장 상태를 확인해주세요." : "프로젝트를 이 브라우저에 저장했어요.");
      return;
    }
    goTo(nextScene(state.step));
  }
  function reset() {
    const result = repository.clear();
    if (!result.ok) {
      setStorageError(result.error);
      return;
    }
    setCurrentState(emptyState());
    setBlocked(false);
    setStorageError("");
    setFieldError("");
    setResetOpen(false);
    setNotice(experience.preview ? "디자인 미리보기를 처음부터 시작합니다." : "이 브라우저의 방출 체험 데이터를 초기화했어요.");
  }
  function retryStorage() {
    if (blocked) {
      const result = repository.load();
      if (!result.ok) {
        setStorageError(result.error);
        return;
      }
      setCurrentState(result.value);
      setBlocked(false);
      setStorageError("");
    } else if (save(state)) setNotice(experience.preview ? "미리보기 입력을 유지했어요. 새로고침하면 사라집니다." : "입력 내용을 이 브라우저에 저장했어요.");
  }
  function updateProject(change: (project: Project) => Project): boolean {
    const latest = stateRef.current;
    if (!latest.project || !save({ ...latest, project: change(latest.project) })) return false;
    setNotice(experience.preview ? "미리보기에 반영했어요. 입력은 저장되지 않습니다." : cloud ? "기기에 보관했어요. 서버 저장 상태를 확인해주세요." : "변경 내용을 이 브라우저에 저장했어요.");
    return true;
  }
  function saveWorkspace(projectId: string, content: string, restoreCount: number): SaveResult {
    const latest = stateRef.current;
    if (blocked || !latest.project || latest.project.id !== projectId || (latest.project.restorePoints?.length ?? 0) !== restoreCount)
      return { ok: false, error: "현재 프로젝트를 확인하지 못했어요. 본문을 내려받아 보관해주세요." };
    let project: Project;
    try { project = withWorkspaceContent(latest.project, content); }
    catch { return { ok: false, error: "본문은 500,000자 이내로 작성해주세요." }; }
    if (project !== latest.project) {
      const next = { ...latest, project };
      const result = repository.save(next);
      if (!result.ok) return { ok: false, error: result.error };
      setCurrentState(next);
      setStorageError("");
    }
    return { ok: true, savedAt: project.workspace?.updatedAt ?? "" };
  }
  function goBack() {
    goTo(previousScene(state.step));
  }

  return (
    <div className="app-shell" data-scene={scene} data-design={experience.design}>
      {experience.design === "cinematic" && <>
        <div className="scene-backdrop" aria-hidden="true" />
        <DoorSmoke paused={smokePaused} />
      </>}
      <a className="skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>
      <header className="site-header">
        <span className="wordmark" aria-label="BANGCHUL">
          BANGCHUL
        </span>
        {accountControls}
        {scene === "dashboard" || blocked ? (
          <span className="header-label">{SCENE_NAMES[scene]}</span>
        ) : (
          <span
            className="scene-number"
            aria-label={`총 ${sceneCount}개 화면 중 ${sceneNumber}번째 화면`}
          >
            {String(sceneNumber).padStart(2, "0")} / {String(sceneCount).padStart(2, "0")}{" "}
            <span aria-hidden="true">—</span>
          </span>
        )}
      </header>
      {experience.preview && <aside className="design-review-notice" aria-label="디자인 미리보기 안내">
        <span>{experience.design === "minimal" ? "A · Minimal Black" : "B · Cinematic Black"}</span>
        <p>디자인 미리보기 · 입력은 저장되지 않으며, 기존 프로젝트는 그대로 유지됩니다.</p>
      </aside>}
      {storageError && !blocked && (
        <div className="storage-banner" role="alert">
          <p>{storageError}</p>
          <button className="text-button" onClick={retryStorage}>
            저장 다시 시도
          </button>
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {notice}
      </div>
      <main
        id="main-content"
        className={state.project ? "main dashboard-main" : "main"}
        inert={switching}
        aria-busy={switching}
      >
        {blocked ? (
          <section className="scene form-scene">
            <p className="eyebrow">YOUR LOCAL DATA</p>
            <h1 ref={headingRef} tabIndex={-1}>
              저장된 내용을
              <br />
              확인해주세요.
            </h1>
            <p className="scene-caption" role="alert">
              {storageError}
            </p>
            <div className="form-actions">
              <button className="primary-button" onClick={retryStorage}>
                다시 시도 <Arrow />
              </button>
              <button
                className="text-button"
                onClick={() => setResetOpen(true)}
              >
                체험 데이터 초기화
              </button>
            </div>
          </section>
        ) : state.project ? (
          <ProjectDashboard
            key={state.project.id}
            project={state.project}
            now={now}
            headingRef={headingRef}
            onUpdate={(change) => stateRef.current.project?.id === state.project!.id ? updateProject(change) : false}
            onReset={() => setResetOpen(true)}
            notice={notice}
            preview={experience.preview}
            cloud={!!cloud}
            cloudUpload={cloud ? async (project, upload, progress) => { await cloud.flush(); return await uploadCloud(project, upload, progress); } : undefined}
            onSaveWorkspace={(content) => saveWorkspace(state.project!.id, content, state.project!.restorePoints?.length ?? 0)}
          />
        ) : (
          <OnboardingScene
            key={state.step}
            step={state.step}
            draft={state.draft}
            now={now}
            error={fieldError}
            headingRef={headingRef}
            onChange={updateDraft}
            onBack={goBack}
            onStart={() => goTo("name")}
            onSubmit={next}
            onValidate={setFieldError}
            preview={experience.preview}
            cloud={!!cloud}
          />
        )}
      </main>
      <footer className="site-footer">
        <span className="footer-scene">
          {scene === "dashboard" || blocked
            ? SCENE_NAMES[scene]
            : `${String(sceneNumber).padStart(2, "0")}. ${SCENE_NAMES[scene]}`}
        </span>
        <div className="footer-meta">
          <span>{experience.preview ? "디자인 검토 · 입력은 저장되지 않습니다." : cloud ? "계정 작업 공간 · 비공개 서버 저장" : "로컬 작업 공간 · 이 브라우저에만 저장됩니다."}</span>
          {experience.design === "cinematic" && <button
            type="button"
            className="motion-toggle"
            aria-label="배경 연기 애니메이션"
            aria-pressed={!smokePaused}
            onClick={() => setSmokePaused((value) => !value)}
          >
            모션 <span aria-hidden="true">{smokePaused ? "끔" : "켬"}</span>
          </button>}
        </div>
      </footer>
      <ResetDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={reset}
        error={storageError}
        preview={experience.preview}
      />
    </div>
  );
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function App() {
  const preview = readExperience(window.location.search).preview;
  const [session, setSession] = useState<AccountSession | null>(null);
  const [cloud, setCloud] = useState<CloudRepository | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const autoOpened = useRef(false);
  useEffect(() => { if (!preview) { void api<AccountSession>("/api/session").then(setSession).catch(() => setSession({ user: null, available: false })); } }, [preview]);
  useEffect(() => {
    if (!session?.user || !session.available || autoOpened.current || new URLSearchParams(window.location.search).get("account") !== "1") return;
    autoOpened.current = true; void openAccount();
  }, [session]);
  useEffect(() => {
    if (!cloud) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (cloud.hasPending()) { event.preventDefault(); event.returnValue = ""; } };
    const visibility = () => { if (document.hidden) void cloud.flush().catch(() => {}); };
    window.addEventListener("beforeunload", beforeUnload); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("visibilitychange", visibility); cloud.dispose(); };
  }, [cloud]);
  async function openAccount() {
    if (!session?.user || busy) return; setBusy(true); setError("");
    try { const remote = await api<CloudSnapshot>("/api/project"); activateCloud(createCloudRepository(session.user.id, remote, window.localStorage)); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  async function localMode() {
    setError(""); try { if (cloud) await cloud.flush(); setCloud(null); window.history.replaceState(null, "", withAccountMode(window.location.href, false)); }
    catch (cause) { setError((cause as Error).message); }
  }
  async function useServer() {
    if (!cloud || busy || !window.confirm("현재 기기의 기록을 별도 보호 백업으로 남긴 뒤 서버 기록을 열까요? 서버 내용은 바꾸지 않습니다.")) return;
    setBusy(true); setError("");
    try { activateCloud(await cloud.replaceFromServer(() => api<CloudSnapshot>("/api/project"))); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  function activateCloud(repository: CloudRepository) {
    setCloud(repository);
    window.history.replaceState(null, "", withAccountMode(window.location.href, true));
  }
  function backup() {
    try {
      const result = (cloud?.repository ?? localRepository).load(); if (!result.ok) throw new Error(result.error);
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.value, null, 2)], { type: "application/json;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = `방출-브라우저기록-${localDate()}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError((cause as Error).message); }
  }
  async function importLocal() {
    if (!session?.user || busy) return; setBusy(true); setError("");
    try {
      const local = localRepository.load(); if (!local.ok) throw new Error(local.error);
      const source = local.value.project; if (!source) throw new Error("이 브라우저에 가져올 프로젝트가 없어요.");
      const remote = await api<CloudSnapshot>("/api/project"); if (remote.state.project) throw new Error("계정에 이미 작품이 있어요. 기존 기록을 덮어쓰지 않았습니다. 계정 작업 공간에서 확인해주세요.");
      const versions = source.mediaVersions ?? [];
      if (versions.length > 20) throw new Error("한 번에 가져올 수 있는 파일은 20개까지예요. 브라우저 원본은 그대로 남아 있어요.");
      if (!window.confirm(`「${source.title}」 프로젝트와 기록을 이 계정으로 복사할까요? 이 브라우저의 원본은 지우지 않습니다.`)) return;
      // Stage a copy without local-only file references; verify each uploaded original by its server hash.
      const copy: Project = { ...source }; delete copy.mediaVersions; delete copy.mediaHistory; delete copy.currentVersionId;
      if (copy.releaseArtifact) copy.releaseArtifact = { ...copy.releaseArtifact, versionId: undefined };
      let revision = (await api<{ revision: number }>("/api/project", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: copy, revision: 0 }) })).revision;
      const migrated: typeof versions = []; const mapping = new Map<string, string>();
      for (const version of versions) {
        const original = await readLocalFile(source.id, version.originalKey);
        const uploaded = await uploadCloud(copy, { original: new File([original], version.filename, { type: version.mime }), sha256: version.sha256,
          ...(version.previewKey ? { preview: await readLocalFile(source.id, version.previewKey), thumbnail: await readLocalFile(source.id, version.thumbnailKey!) } : {}),
        }, () => {});
        if (uploaded.sha256 !== version.sha256 || uploaded.size !== version.size) throw new Error("원본 파일 검증이 일치하지 않아요. 브라우저 원본은 보존됩니다.");
        migrated.push(uploaded); mapping.set(version.id, uploaded.id);
      }
      if (versions.length) {
        copy.mediaVersions = migrated; copy.currentVersionId = source.currentVersionId ? mapping.get(source.currentVersionId) : undefined;
        copy.mediaHistory = Object.fromEntries(Object.entries(source.mediaHistory ?? {}).map(([date, id]) => [date, mapping.get(id)!]));
        if (copy.releaseArtifact && source.releaseArtifact?.versionId) copy.releaseArtifact.versionId = mapping.get(source.releaseArtifact.versionId);
        revision = (await api<{ revision: number }>("/api/project", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: copy, revision }) })).revision;
      }
      const verified = await api<CloudSnapshot>("/api/project");
      const normalize = (p: Project | null) => p ? { ...p, ...(p.mediaVersions ? { mediaVersions: [...p.mediaVersions].sort((a, b) => a.id.localeCompare(b.id)) } : {}), ...(p.restorePoints ? { restorePoints: [...p.restorePoints].sort((a, b) => a.id.localeCompare(b.id)) } : {}) } : null;
      if (verified.revision !== revision || canonical(normalize(verified.state.project)) !== canonical(normalize(copy))) throw new Error("복사한 기록의 검증을 완료하지 못했어요. 브라우저 원본은 그대로 유지됩니다.");
      activateCloud(createCloudRepository(session.user.id, verified, window.localStorage));
    } catch (cause) { setError(`${(cause as Error).message} 가져오기가 중단됐다면 계정에 복사된 내용도 별도로 확인해주세요.`); }
    finally { setBusy(false); }
  }
  return <Application key={cloud?.id ?? "local"} switching={busy} repository={cloud?.repository} cloud={cloud} accountControls={<AccountControls session={session} cloud={cloud} busy={busy} error={error} preview={preview} onOpen={() => { void openAccount(); }} onLocal={() => { void localMode(); }} onImport={() => { void importLocal(); }} onBackup={backup} onUseServer={() => { void useServer(); }} />} />;
}
export default App;
