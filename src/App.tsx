import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { localRepository } from "./data/local-repository";
import { createPreviewRepository } from "./data/preview-repository";
import { nextScene, ONBOARDING_SCENES, previousScene, readExperience } from "./domain/experience";
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

function App() {
  const [experience] = useState(() => readExperience(window.location.search));
  const [repository] = useState(() => experience.preview ? createPreviewRepository() : localRepository);
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
        setNotice(experience.preview ? "미리보기 프로젝트를 만들었어요. 입력은 저장되지 않습니다." : "프로젝트를 이 브라우저에 저장했어요.");
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
    setNotice(experience.preview ? "미리보기에 반영했어요. 입력은 저장되지 않습니다." : "변경 내용을 이 브라우저에 저장했어요.");
    return true;
  }
  function saveWorkspace(projectId: string, content: string): SaveResult {
    const latest = stateRef.current;
    if (blocked || !latest.project || latest.project.id !== projectId)
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
            onUpdate={updateProject}
            onReset={() => setResetOpen(true)}
            notice={notice}
            preview={experience.preview}
            onSaveWorkspace={(content) => saveWorkspace(state.project!.id, content)}
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
          <span>{experience.preview ? "디자인 검토 · 입력은 저장되지 않습니다." : "로컬 체험 · 이 브라우저에만 저장됩니다."}</span>
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

export default App;
