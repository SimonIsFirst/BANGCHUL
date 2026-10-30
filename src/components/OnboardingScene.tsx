import type { FormEvent, RefObject } from "react";
import {
  dateAfter,
  daysUntil,
  ddayLabel,
  DESCRIPTION_LIMIT,
  localDate,
  NAME_LIMIT,
  parseLocalDate,
  TITLE_LIMIT,
  validateStep,
} from "../domain/project";
import type { Draft, LocalState, Step } from "../domain/project";
import { Arrow } from "./Arrow";

const QUESTIONS: Record<Step, string> = {
  name: "당신의 이름은?",
  title: "무엇을\n방출하시겠습니까?",
  description: "어떤 작품인가요?",
  transition: "이제, 세상에 내놓을 날짜를 정해볼까요?",
  deadline: "얼마 동안\n만들겠습니까?",
  agreement: "정해진 날, 세상 밖으로.",
};

interface Props {
  step: LocalState["step"];
  draft: Draft;
  now: Date;
  error: string;
  preview: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onChange(patch: Partial<Draft>): void;
  onBack(): void;
  onStart(): void;
  onSubmit(event: FormEvent): void;
  onValidate(error: string): void;
}

export function OnboardingScene({
  step,
  draft,
  now,
  error,
  preview,
  headingRef,
  onChange,
  onBack,
  onStart,
  onSubmit,
  onValidate,
}: Props) {
  if (step === "opening")
    return (
      <section className="scene opening-scene">
        <p className="opening-eyebrow">방출이 지향하는 약속</p>
        <h1 className="opening-title" ref={headingRef} tabIndex={-1} aria-label="시간이 끝나면, 당신의 작품은 공개됩니다.">
          <span>시간이 끝나면,</span>
          <span>당신의 작품은<span className="headline-space"> </span><br className="headline-mobile-break" />공개됩니다.</span>
        </h1>
        <p className="opening-caption">생각만 하던 것을, 세상 밖으로.</p>
        <div className="opening-actions">
          <button className="opening-cta" onClick={onStart}>
            첫 방출 시작하기 <Arrow />
          </button>
          <p className="opening-disclosure">
            현재는 {preview ? "디자인 미리보기" : "로컬 체험"} 버전입니다.
            <br />{preview ? "입력은 저장되지 않으며, 자동 공개되지 않습니다." : "등록 내용은 이 브라우저에만 저장되며, 자동 공개되지 않습니다."}
          </p>
        </div>
      </section>
    );

  if (step === "transition")
    return (
      <section className="scene transition-scene">
        <p className="eyebrow">이름과 작품, 설명까지 적었어요.</p>
        <p className="transition-project">{draft.title}</p>
        <h1 ref={headingRef} tabIndex={-1}>
          이제, 세상에 내놓을<br />날짜를 정해볼까요?
        </h1>
        <p className="transition-caption">완벽한 계획보다, 시작할 날짜 하나.</p>
        <form onSubmit={onSubmit} className="transition-actions">
          <button type="submit" className="opening-cta">날짜 정하기 <Arrow /></button>
          <button type="button" className="back-button" onClick={onBack}><span aria-hidden="true">←</span> 설명으로 돌아가기</button>
        </form>
      </section>
    );

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const startDate = draft.startDate || localDate(now);
  const start = parseLocalDate(startDate) || now;
  const validation = validateStep(step, { ...draft, startDate }, now);
  const visibleError =
    error || (step === "deadline" && draft.releaseDate ? validation : "");
  const validate = () =>
    onValidate(validateStep(step, { ...draft, startDate }, new Date()) || "");
  const dateText = draft.releaseDate.split("-").join(". ");

  return (
    <section className={`scene form-scene scene-${step}`}>
      <div className="question-heading">
        {step === "agreement" ? (
          <h1
            className="agreement-time"
            aria-label={QUESTIONS.agreement}
            ref={headingRef}
            tabIndex={-1}
          >
            <span>{dateText}</span>
            <span>23:59</span>
          </h1>
        ) : (
          <h1 ref={headingRef} tabIndex={-1}>
            {QUESTIONS[step]}
          </h1>
        )}
        {step === "description" && (
          <span className="help-wrap">
            <button
              className="help-button"
              type="button"
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
              <strong>이렇게 적어도 좋아요</strong>스물아홉의 마지막 여름을 사진
              열 장과 짧은 글로 엮어, 평범한 하루가 특별해지는 순간을 담은 작은
              사진집을 만들어요.
            </span>
          </span>
        )}
      </div>
      {step === "agreement" && (
        <p className="agreement-caption">
          세상에 내놓기로 정한 시간.
          <br />
          완성 여부는 묻지 않습니다.
        </p>
      )}
      <form onSubmit={onSubmit} noValidate>
        {step === "name" && (
          <div className="field-block">
            <label className="sr-only" htmlFor="creator-name">
              이름 또는 활동명
            </label>
            <input
              id="creator-name"
              className="line-input"
              placeholder="이름이나 활동명을 적어주세요."
              autoComplete="nickname"
              value={draft.name}
              maxLength={NAME_LIMIT}
              required
              aria-invalid={!!error}
              aria-describedby="field-error"
              onChange={(e) => onChange({ name: e.target.value })}
              onBlur={validate}
            />
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
              placeholder="프로젝트명을 입력하세요."
              autoComplete="off"
              value={draft.title}
              maxLength={TITLE_LIMIT}
              required
              aria-invalid={!!error}
              aria-describedby="field-hint field-error"
              onChange={(e) => onChange({ title: e.target.value })}
              onBlur={validate}
            />
            <p className="field-hint" id="field-hint">
              단편소설, 사진집, 음악. 무엇이든 좋아요.
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
              className="description-input"
              rows={5}
              placeholder="당신이 만들고 싶은 작품에 대해 자유롭게 적어주세요."
              value={draft.description}
              maxLength={DESCRIPTION_LIMIT}
              required
              aria-invalid={!!error}
              aria-describedby="field-hint field-error"
              onChange={(e) => onChange({ description: e.target.value })}
              onBlur={validate}
            />
            <div className="field-meta">
              <p className="field-hint" id="field-hint">
                한 문장으로 시작해도 충분해요.
              </p>
              <span>
                {draft.description.length} / {DESCRIPTION_LIMIT}
              </span>
            </div>
          </div>
        )}
        {step === "deadline" && (
          <div className="field-block period-field">
            <div className="date-row">
              <label htmlFor="start-date">시작일</label>
              <input
                id="start-date"
                type="date"
                min={localDate(now)}
                max="9999-12-31"
                value={startDate}
                required
                aria-invalid={!!visibleError}
                aria-describedby="field-error"
                onInput={(e) => onChange({ startDate: e.currentTarget.value })}
                onChange={(e) => onChange({ startDate: e.target.value })}
                onBlur={validate}
              />
            </div>
            <div className="date-row">
              <label htmlFor="release-date">종료일 · 공개 예정일</label>
              <input
                id="release-date"
                type="date"
                min={startDate > localDate(now) ? startDate : localDate(now)}
                max="9999-12-31"
                value={draft.releaseDate}
                required
                aria-invalid={!!visibleError}
                aria-describedby="date-summary field-error"
                onInput={(e) =>
                  onChange({ releaseDate: e.currentTarget.value })
                }
                onChange={(e) => onChange({ releaseDate: e.target.value })}
                onBlur={validate}
              />
            </div>
            <div
              className="date-presets"
              role="group"
              aria-label="창작 기간 선택"
            >
              {[7, 14, 30].map((days) => (
                <button
                  key={days}
                  type="button"
                  aria-pressed={draft.releaseDate === dateAfter(days, start)}
                  onClick={() =>
                    onChange({ startDate, releaseDate: dateAfter(days, start) })
                  }
                >
                  {days}일
                </button>
              ))}
            </div>
            <div
              className="period-summary"
              id="date-summary"
              aria-live="polite"
            >
              {draft.releaseDate && !validation ? (
                <>
                  <strong>{daysUntil(draft.releaseDate, start)} DAYS</strong>
                  <span>{ddayLabel(daysUntil(draft.releaseDate, now))}</span>
                </>
              ) : (
                <span>당신의 창작에 기한을 정해주세요.</span>
              )}
            </div>
            <p className="field-hint time-zone">종료일 23:59 · {zone} 기준</p>
          </div>
        )}
        {step === "agreement" && (
          <div className="agreement-content">
            <p className="release-project-name">{draft.title}</p>
            <p className="agreement-zone">공개 예정일 · {zone} 기준</p>
            <div className="local-disclosure">
              <p>{preview ? "현재는 디자인 미리보기입니다." : "현재는 로컬 체험 버전입니다."}</p>
              <p>
                {preview ? "입력은 새로고침하면 사라지며," : "등록 내용은 이 브라우저에만 저장되며,"}
                <br />
                작품이 다른 사람에게 공개되지는 않습니다.
                <br />
                실제 자동 공개 기능은 아직 제공되지 않습니다.
              </p>
            </div>
            <label className="agreement-checkbox">
              <input
                type="checkbox"
                checked={draft.agreed}
                onChange={(e) => onChange({ agreed: e.target.checked })}
                aria-describedby="field-error"
              />
              <span>
                {preview ? "디자인 미리보기 안내를 확인했습니다." : <>로컬 체험 안내를 확인했으며,<br className="mobile-break" /> 이 브라우저에 저장하는 것에 동의합니다.</>}
              </span>
            </label>
          </div>
        )}
        <p className="field-error" id="field-error" role="alert">
          {visibleError}
        </p>
        <div
          className={`form-actions ${step === "agreement" ? "agreement-actions" : ""}`}
        >
          <button type="button" className="back-button" onClick={onBack}>
            <span aria-hidden="true">←</span> 이전
          </button>
          <button
            className={step === "agreement" ? "primary-button" : "next-button"}
            type="submit"
            disabled={!!validation}
            aria-label={step === "agreement" ? "동의하고 시작하기" : "다음"}
          >
            {step === "agreement" && <span>동의하고 시작하기</span>}
            <Arrow />
          </button>
        </div>
      </form>
    </section>
  );
}
