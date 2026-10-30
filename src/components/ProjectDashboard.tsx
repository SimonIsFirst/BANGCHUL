import { useState } from "react";
import type { FormEvent, RefObject } from "react";
import {
  daysUntil,
  ddayLabel,
  DESCRIPTION_LIMIT,
  formatInstant,
  formatDate,
  localDate,
  NOTE_LIMIT,
  projectStatus,
} from "../domain/project";
import type { Project } from "../domain/project";
import type { SaveResult } from "../domain/autosave";
import { WorkspaceEditor } from "./WorkspaceEditor";
import { CalendarHistory } from "./CalendarHistory";

interface Props {
  project: Project;
  now: Date;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onUpdate(change: (project: Project) => Project): boolean;
  onSaveWorkspace(content: string): SaveResult;
  onReset(): void;
  notice: string;
  preview: boolean;
}

export function ProjectDashboard({
  project,
  now,
  headingRef,
  onUpdate,
  onReset,
  notice,
  preview,
  onSaveWorkspace,
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
      onUpdate((current) => ({
        ...current,
        description: description.trim(),
        updatedAt: new Date().toISOString(),
      }))
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
      onUpdate((current) => ({
        ...current,
        updatedAt: timestamp,
        notes: [
          { id: crypto.randomUUID(), text: note.trim(), createdAt: timestamp },
          ...current.notes,
        ],
      }))
    ) {
      setNote("");
      setNoteError("");
    }
  }

  return (
    <section className="scene dashboard-scene">
      <div className="workspace-project-header">
        <div className="project-identity">
          <p className="section-label">YOUR CREATIVE SPACE</p>
          <h1 ref={headingRef} tabIndex={-1}>{project.title}</h1>
          <span className="project-state">
            <span className="status-dot" aria-hidden="true" />
            {projectStatus(project, now)}
          </span>
          <a className="workspace-jump" href="#workspace-content">작업 이어쓰기 <span aria-hidden="true">↓</span></a>
        </div>
        <div className="countdown">
          <p className="section-label">공개 예정일까지</p>
          <strong>{ddayLabel(days)}</strong>
        </div>
      </div>
      <div className="creative-dashboard-grid">
        <WorkspaceEditor title={project.title} workspace={project.workspace} preview={preview} onSave={onSaveWorkspace} />
        <CalendarHistory history={project.history} now={now} />
        <section className="project-details" aria-labelledby="project-details-heading">
          <div className="section-heading">
            <h2 id="project-details-heading">작품 소개</h2>
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
            <p className="project-description" tabIndex={0}>{project.description}</p>
          )}
          <dl className="project-dates">
            <div>
              <dt>창작자</dt>
              <dd>{project.name}</dd>
            </div>
            <div>
              <dt>시작일</dt>
              <dd>
                {project.startDate
                  ? formatDate(project.startDate)
                  : formatInstant(project.startedAt, project.timeZone)}
              </dd>
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
            <br />{preview ? "디자인 미리보기의 입력은 저장되지 않으며 새로고침하면 사라집니다." : "이 프로젝트와 기록은 현재 브라우저에서만 볼 수 있어요."}
          </p>
        </section>
        <details className="legacy-notes">
          <summary>진행 메모 <span>{project.notes.length}개</span></summary>
          <p className="legacy-note-caption">이전 버전의 메모도 그대로 있어요. 메모와 작품 본문은 따로 보관됩니다.</p>
          <div className="section-heading">
            <h3>따로 남겨두는 메모</h3>
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
            <h3>메모 목록</h3>
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
        </details>
      </div>
      <div className="dashboard-bottom">
        <p className="saved-notice" aria-hidden="true">
          {notice || (preview ? "디자인 미리보기 · 저장되지 않음" : "프로젝트 · 비공개 로컬 체험")}
        </p>
        <button className="text-button reset-button" onClick={onReset}>
          프로젝트 초기화
        </button>
      </div>
    </section>
  );
}
