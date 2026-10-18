import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { localRepository } from "./data/local-repository";
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
import "./App.css";

const SCENE_NAMES = {
  opening: "OPENING",
  name: "NAME",
  title: "PROJECT",
  description: "DESCRIPTION",
  deadline: "PERIOD",
  agreement: "AGREEMENT",
  dashboard: "MY PROJECT",
  "storage-error": "LOCAL DATA",
};

function App() {
  const [initial] = useState(() => localRepository.load());
  const [state, setState] = useState<LocalState>(() =>
    initial.ok ? initial.value : emptyState(),
  );
  const [blocked, setBlocked] = useState(!initial.ok);
  const [storageError, setStorageError] = useState(
    initial.ok ? "" : initial.error,
  );
  const [fieldError, setFieldError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const scene = blocked
    ? "storage-error"
    : state.project
      ? "dashboard"
      : state.step;
  const sceneNumber =
    state.step === "opening" ? 1 : STEPS.indexOf(state.step) + 2;

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

  function save(next: LocalState, keepInputOnFailure = false): boolean {
    if (blocked) return false;
    const result = localRepository.save(next);
    if (!result.ok) {
      setStorageError(result.error);
      if (keepInputOnFailure) setState(next);
      return false;
    }
    setState(next);
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
        setNotice("프로젝트를 이 브라우저에 저장했어요.");
      return;
    }
    goTo(STEPS[STEPS.indexOf(state.step) + 1]);
  }
  function reset() {
    const result = localRepository.clear();
    if (!result.ok) {
      setStorageError(result.error);
      return;
    }
    setState(emptyState());
    setBlocked(false);
    setStorageError("");
    setFieldError("");
    setResetOpen(false);
    setNotice("이 브라우저의 방출 체험 데이터를 초기화했어요.");
  }
  function retryStorage() {
    if (blocked) {
      const result = localRepository.load();
      if (!result.ok) {
        setStorageError(result.error);
        return;
      }
      setState(result.value);
      setBlocked(false);
      setStorageError("");
    } else if (save(state)) setNotice("입력 내용을 이 브라우저에 저장했어요.");
  }
  function updateProject(project: Project): boolean {
    if (!save({ ...state, project })) return false;
    setNotice("변경 내용을 이 브라우저에 저장했어요.");
    return true;
  }
  function goBack() {
    const index = state.step === "opening" ? 0 : STEPS.indexOf(state.step);
    goTo(index <= 0 ? "opening" : STEPS[index - 1]);
  }

  return (
    <div className="app-shell" data-scene={scene}>
      <div className="scene-backdrop" aria-hidden="true" />
      <div className="scene-mist" aria-hidden="true" />
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
            aria-label={`총 6개 화면 중 ${sceneNumber}번째 화면`}
          >
            {String(sceneNumber).padStart(2, "0")} / 06{" "}
            <span aria-hidden="true">—</span>
          </span>
        )}
      </header>
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
          />
        )}
      </main>
      <footer className="site-footer">
        <span className="footer-scene">
          {scene === "dashboard" || blocked
            ? SCENE_NAMES[scene]
            : `${String(sceneNumber).padStart(2, "0")}. ${SCENE_NAMES[scene]}`}
        </span>
        <span>로컬 체험 · 이 브라우저에만 저장됩니다.</span>
      </footer>
      <ResetDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={reset}
        error={storageError}
      />
    </div>
  );
}

export default App;
