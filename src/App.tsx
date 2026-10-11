import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { localRepository } from "./data/local-repository";
import {
  createProject,
  dateAfter,
  daysUntil,
  ddayLabel,
  deadlineError,
  DESCRIPTION_LIMIT,
  emptyState,
  formatDate,
  localDate,
  NAME_LIMIT,
  STEPS,
  TITLE_LIMIT,
  validateStep,
} from "./domain/project";
import type { Draft, LocalState, Project, Step } from "./domain/project";
import { ProjectDashboard } from "./components/ProjectDashboard";
import { ResetDialog } from "./components/ResetDialog";
import "./App.css";

const QUESTIONS: Record<Step, { title: string; caption: string }> = {
  name: {
    title: "당신의 이름은 무엇인가요?",
    caption: "이름도, 활동명도 좋아요.",
  },
  title: {
    title: "무엇을 만들고 싶나요?",
    caption: "언젠가 시작하고 싶었던 그 작품.",
  },
  description: {
    title: "어떤 작품인가요?",
    caption: "아직 명확하지 않아도 괜찮아요.",
  },
  deadline: {
    title: "언제 세상에 내놓을까요?",
    caption: "공개할 날짜를 정해보세요.",
  },
  agreement: {
    title: "정해진 날, 세상 밖으로.",
    caption:
      "BANGCHUL은 완성 여부와 관계없이 작품을 세상에 공개하는 경험을 지향합니다.",
  },
};

function Arrow() {
  return (
    <span aria-hidden="true" className="arrow">
      ↗
    </span>
  );
}

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
    save({ ...state, step }, true);
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
      const project = createProject(state.draft);
      if (save({ ...emptyState(), project }))
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

  const step = state.step === "opening" ? null : state.step;
  const index = step ? STEPS.indexOf(step) : -1;
  const dateInvalid = deadlineError(state.draft.releaseDate, now);
  const currentError = step ? validateStep(step, state.draft, now) : null;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>
      <header className="site-header">
        <span className="wordmark" aria-label="BANGCHUL">
          BANGCHUL
        </span>
        <span className="edition">
          LOCAL EXPERIENCE <span className="edition-version">/ MVP 1.0</span>
        </span>
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
          <section className="scene form-scene" key="storage-error">
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
        ) : state.step === "opening" ? (
          <section className="scene opening-scene" key="opening">
            <h1 className="opening-title" ref={headingRef} tabIndex={-1}>
              <span>생각만 하던 것을,</span>
              <span>세상 밖으로.</span>
            </h1>
            <p className="opening-caption">
              만들고 싶은 것 하나.
              <br />
              공개할 날짜 하나.
            </p>
            <button
              className="primary-button opening-cta"
              onClick={() => goTo("name")}
            >
              첫 방출 시작하기 <Arrow />
            </button>
          </section>
        ) : (
          step && (
            <section
              className={`scene form-scene ${step === "agreement" ? "agreement-scene" : ""}`}
              key={step}
            >
              <div className="step-heading">
                <p className="eyebrow">YOUR FIRST RELEASE</p>
                <p
                  className="step-count"
                  aria-label={`총 ${STEPS.length}단계 중 ${index + 1}단계`}
                >
                  {String(index + 1).padStart(2, "0")}
                  <span> / {String(STEPS.length).padStart(2, "0")}</span>
                </p>
              </div>
              <div className="step-progress" aria-hidden="true">
                {STEPS.map((item, i) => (
                  <span className={i <= index ? "active" : ""} key={item} />
                ))}
              </div>
              <div className="question-heading">
                <h1 ref={headingRef} tabIndex={-1}>
                  {QUESTIONS[step].title}
                </h1>
                {step === "description" && (
                  <span className="help-wrap">
                    <button
                      type="button"
                      className="help-button"
                      aria-label="작품 설명 예시"
                      aria-describedby="description-example"
                    >
                      ?
                    </button>
                    <span
                      className="help-tooltip"
                      id="description-example"
                      role="tooltip"
                    >
                      <strong>이렇게 적어도 좋아요</strong>스물아홉의 마지막
                      여름을 사진 열 장과 짧은 글로 엮어, 평범한 하루가
                      특별해지는 순간을 담은 작은 사진집을 만들어요.
                    </span>
                  </span>
                )}
              </div>
              <p className="scene-caption">{QUESTIONS[step].caption}</p>
              <form onSubmit={next} noValidate>
                {step === "name" && (
                  <div className="field-block">
                    <label className="sr-only" htmlFor="creator-name">
                      이름 또는 활동명
                    </label>
                    <input
                      id="creator-name"
                      className="line-input"
                      placeholder="이름 또는 활동명"
                      value={state.draft.name}
                      maxLength={NAME_LIMIT}
                      autoComplete="nickname"
                      required
                      aria-invalid={!!fieldError}
                      aria-describedby="field-hint field-error"
                      onChange={(e) => updateDraft({ name: e.target.value })}
                      onBlur={() =>
                        setFieldError(validateStep(step, state.draft) ?? "")
                      }
                    />
                    <p className="field-hint" id="field-hint">
                      어떤 이름으로 첫 작품을 남길까요?
                    </p>
                  </div>
                )}
                {step === "title" && (
                  <div className="field-block">
                    <label className="sr-only" htmlFor="project-title">
                      프로젝트 이름
                    </label>
                    <input
                      id="project-title"
                      className="line-input"
                      placeholder="나의 첫 단편소설"
                      value={state.draft.title}
                      maxLength={TITLE_LIMIT}
                      autoComplete="off"
                      required
                      aria-invalid={!!fieldError}
                      aria-describedby="field-hint field-error"
                      onChange={(e) => updateDraft({ title: e.target.value })}
                      onBlur={() =>
                        setFieldError(validateStep(step, state.draft) ?? "")
                      }
                    />
                    <p className="field-hint" id="field-hint">
                      예: 나의 첫 단편소설 · 필름 사진집 · 작은 독립 잡지
                    </p>
                  </div>
                )}
                {step === "description" && (
                  <div className="field-block">
                    <label className="sr-only" htmlFor="project-description">
                      작품 설명
                    </label>
                    <textarea
                      id="project-description"
                      className="line-input description-input"
                      rows={3}
                      placeholder="어떤 이야기를, 어떤 모습으로 만들고 싶은가요?"
                      value={state.draft.description}
                      maxLength={DESCRIPTION_LIMIT}
                      required
                      aria-invalid={!!fieldError}
                      aria-describedby="field-hint field-error"
                      onChange={(e) =>
                        updateDraft({ description: e.target.value })
                      }
                      onBlur={() =>
                        setFieldError(validateStep(step, state.draft) ?? "")
                      }
                    />
                    <div className="field-meta">
                      <p className="field-hint" id="field-hint">
                        한 문장으로 시작해도 충분해요.
                      </p>
                      <span>
                        {state.draft.description.length} / {DESCRIPTION_LIMIT}
                      </span>
                    </div>
                  </div>
                )}
                {step === "deadline" && (
                  <div className="field-block date-field">
                    <div
                      className="date-presets"
                      role="group"
                      aria-label="공개 예정일까지 기간"
                    >
                      {[7, 14, 30].map((days) => (
                        <button
                          type="button"
                          key={days}
                          className="date-preset"
                          aria-pressed={
                            state.draft.releaseDate === dateAfter(days, now)
                          }
                          onClick={() =>
                            updateDraft({ releaseDate: dateAfter(days, now) })
                          }
                        >
                          {days}일 뒤
                        </button>
                      ))}
                    </div>
                    <div className="custom-date">
                      <label htmlFor="release-date">직접 날짜 선택</label>
                      <input
                        id="release-date"
                        type="date"
                        min={localDate(now)}
                        max="9999-12-31"
                        value={state.draft.releaseDate}
                        required
                        aria-invalid={
                          !!fieldError ||
                          (!!state.draft.releaseDate && !!dateInvalid)
                        }
                        aria-describedby="date-summary field-error"
                        onInput={(e) =>
                          updateDraft({ releaseDate: e.currentTarget.value })
                        }
                        onChange={(e) =>
                          updateDraft({ releaseDate: e.target.value })
                        }
                        onBlur={() =>
                          setFieldError(validateStep(step, state.draft) ?? "")
                        }
                      />
                    </div>
                    <div
                      className="date-summary"
                      id="date-summary"
                      aria-live="polite"
                    >
                      {!dateInvalid ? (
                        <>
                          <span>{formatDate(state.draft.releaseDate)}</span>
                          <strong>
                            {ddayLabel(daysUntil(state.draft.releaseDate, now))}
                          </strong>
                        </>
                      ) : (
                        <span>작품을 세상에 내놓을 날짜를 정해주세요.</span>
                      )}
                    </div>
                    <p className="field-hint">
                      선택한 날 23:59 · {zone} 기준
                      <br />
                      현재는 예정일만 기록하며, 실제로 공개되지는 않아요.
                    </p>
                  </div>
                )}
                {step === "agreement" && (
                  <div className="agreement-content">
                    <dl className="project-summary">
                      <div>
                        <dt>첫 작품</dt>
                        <dd>{state.draft.title}</dd>
                      </div>
                      <div>
                        <dt>공개 예정일</dt>
                        <dd>
                          {formatDate(state.draft.releaseDate)} · 23:59{" "}
                          <span>{zone}</span>
                        </dd>
                      </div>
                    </dl>
                    <div className="local-disclosure">
                      <p className="disclosure-label">
                        시작하기 전에 확인해주세요.
                      </p>
                      <ul>
                        <li>현재는 로컬 체험 버전이에요.</li>
                        <li>등록 내용은 이 브라우저에만 저장돼요.</li>
                        <li>작품이 다른 사람에게 공개되지는 않아요.</li>
                        <li>실제 공개 기능은 향후 구현될 예정이에요.</li>
                      </ul>
                    </div>
                    <label className="agreement-checkbox">
                      <input
                        type="checkbox"
                        checked={state.draft.agreed}
                        onChange={(e) =>
                          updateDraft({ agreed: e.target.checked })
                        }
                        aria-describedby="field-error"
                      />
                      <span>
                        로컬 체험 안내를 확인했으며, 이 브라우저에 저장하는 것에
                        동의해요.
                      </span>
                    </label>
                  </div>
                )}
                <p className="field-error" id="field-error" role="alert">
                  {fieldError ||
                    (step === "deadline" && state.draft.releaseDate
                      ? dateInvalid
                      : "")}
                </p>
                <div className="form-actions">
                  <button
                    type="button"
                    className="back-button"
                    onClick={() =>
                      goTo(index === 0 ? "opening" : STEPS[index - 1])
                    }
                  >
                    <span aria-hidden="true">←</span> 이전
                  </button>
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={!!currentError}
                  >
                    {step === "agreement" ? "내 첫 방출 시작하기" : "다음"}{" "}
                    <Arrow />
                  </button>
                </div>
              </form>
            </section>
          )
        )}
      </main>
      <footer className="site-footer">
        <span>완벽보다 완성.</span>
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
