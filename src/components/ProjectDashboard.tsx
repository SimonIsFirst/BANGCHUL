import { useState } from "react";
import type { FormEvent, RefObject } from "react";
import {
  daysUntil,
  ddayLabel,
  DESCRIPTION_LIMIT,
  formatInstant,
  localDate,
  NOTE_LIMIT,
  projectStatus,
} from "../domain/project";
import type { Project } from "../domain/project";

interface Props {
  project: Project;
  now: Date;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onUpdate(project: Project): boolean;
  onReset(): void;
  notice: string;
}

export function ProjectDashboard({
  project,
  now,
  headingRef,
  onUpdate,
  onReset,
  notice,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(project.description);
  const [descriptionError, setDescriptionError] = useState("");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const days = daysUntil(localDate(new Date(project.releaseAt)), now);

  function saveDescription(event: FormEvent) {
    event.preventDefault();
    if (!description.trim()) {
      setDescriptionError("작품 설명을 한 문장 이상 입력해주세요.");
      return;
    }
    if (
      onUpdate({
        ...project,
        description: description.trim(),
        updatedAt: new Date().toISOString(),
      })
    ) {
      setEditing(false);
      setDescriptionError("");
    }
  }

  function addNote(event: FormEvent) {
    event.preventDefault();
    if (!note.trim()) {
      setNoteError("오늘의 작은 진전이나 생각을 적어주세요.");
      return;
    }
    const timestamp = new Date().toISOString();
    if (
      onUpdate({
        ...project,
        updatedAt: timestamp,
        notes: [
          { id: crypto.randomUUID(), text: note.trim(), createdAt: timestamp },
          ...project.notes,
        ],
      })
    ) {
      setNote("");
      setNoteError("");
    }
  }

  return (
    <section className="scene dashboard-scene">
      <div className="dashboard-intro">
        <p className="eyebrow">YOUR FIRST RELEASE</p>
        <h1 ref={headingRef} tabIndex={-1}>
          첫 방출이 시작됐어요.
        </h1>
        <p className="scene-caption">
          {project.name}님의 첫 작품, 이제 한 걸음씩 만들어가요.
        </p>
      </div>
      <div className="project-overview">
        <div className="project-identity">
          <p className="section-label">THE PROJECT</p>
          <h2>{project.title}</h2>
          <span className="project-state">
            <span className="status-dot" aria-hidden="true" />
            {projectStatus(project, now)}
          </span>
        </div>
        <div className="countdown">
          <p className="section-label">공개 예정일까지</p>
          <strong>{ddayLabel(days)}</strong>
        </div>
      </div>
      <div className="dashboard-columns">
        <div className="project-details">
          <div className="section-heading">
            <h3>작품 소개</h3>
            {!editing && (
              <button
                className="text-button"
                onClick={() => {
                  setDescription(project.description);
                  setEditing(true);
                }}
              >
                수정
              </button>
            )}
          </div>
          {editing ? (
            <form
              className="description-editor"
              onSubmit={saveDescription}
              noValidate
            >
              <label className="sr-only" htmlFor="edit-description">
                작품 설명 수정
              </label>
              <textarea
                id="edit-description"
                rows={5}
                autoFocus
                value={description}
                maxLength={DESCRIPTION_LIMIT}
                aria-invalid={!!descriptionError}
                aria-describedby="description-edit-error"
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDescriptionError("");
                }}
              />
              <p
                className="field-error"
                id="description-edit-error"
                role="alert"
              >
                {descriptionError}
              </p>
              <div className="editor-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setEditing(false)}
                >
                  취소
                </button>
                <button className="small-button" disabled={!description.trim()}>
                  설명 저장
                </button>
              </div>
            </form>
          ) : (
            <p className="project-description">{project.description}</p>
          )}
          <dl className="project-dates">
            <div>
              <dt>창작자</dt>
              <dd>{project.name}</dd>
            </div>
            <div>
              <dt>시작일</dt>
              <dd>{formatInstant(project.startedAt, project.timeZone)}</dd>
            </div>
            <div>
              <dt>공개 예정일</dt>
              <dd>
                {formatInstant(project.releaseAt, project.timeZone)}
                <span>{project.timeZone} 기준</span>
              </dd>
            </div>
          </dl>
          <p className="privacy-note">
            예정일이 지나도 자동으로 게시되지는 않아요.
            <br />이 프로젝트와 기록은 현재 브라우저에서만 볼 수 있어요.
          </p>
        </div>
        <div className="project-journal">
          <div className="section-heading">
            <h3>오늘의 작은 진전</h3>
            <span className="section-label">한 줄도 좋아요</span>
          </div>
          <form className="note-form" onSubmit={addNote} noValidate>
            <label className="sr-only" htmlFor="progress-note">
              진행 기록 또는 메모
            </label>
            <textarea
              id="progress-note"
              rows={3}
              placeholder="오늘 만들었거나, 떠올린 것을 남겨보세요."
              value={note}
              maxLength={NOTE_LIMIT}
              aria-invalid={!!noteError}
              aria-describedby="note-error"
              onChange={(e) => {
                setNote(e.target.value);
                setNoteError("");
              }}
            />
            <div className="note-actions">
              <span className="field-hint">
                {note.length} / {NOTE_LIMIT}
              </span>
              <button className="small-button" disabled={!note.trim()}>
                기록 남기기 <span aria-hidden="true">↗</span>
              </button>
            </div>
            <p className="field-error" id="note-error" role="alert">
              {noteError}
            </p>
          </form>
          <div className="journal-header">
            <h3>나의 기록</h3>
            <span>{project.notes.length}</span>
          </div>
          {project.notes.length === 0 ? (
            <p className="empty-journal">
              아직 기록이 없어요.
              <br />첫 문장, 첫 스케치, 첫 생각부터 남겨보세요.
            </p>
          ) : (
            <ol className="journal-list">
              {project.notes.map((item) => (
                <li key={item.id}>
                  <time dateTime={item.createdAt}>
                    {formatInstant(item.createdAt)}
                  </time>
                  <p>{item.text}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      <div className="dashboard-bottom">
        <p className="saved-notice" aria-hidden="true">
          {notice || "이 브라우저에 저장됨"}
        </p>
        <button className="text-button reset-button" onClick={onReset}>
          프로젝트 초기화
        </button>
      </div>
    </section>
  );
}
