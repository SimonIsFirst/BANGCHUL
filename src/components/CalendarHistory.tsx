import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { dateAfter, formatDate, formatInstant, localDate, parseLocalDate } from "../domain/project";
import type { DailySnapshot, Project } from "../domain/project";
import { adjacentMonth, monthCells } from "../domain/workspace";
import { restoreWriting } from "../domain/restore";
import { MediaPreview } from "./MediaWorkspace";

interface Props { history?: Record<string, DailySnapshot>; now: Date; project: Project; onUpdate(change: (project: Project) => Project): boolean; cloud?: boolean }
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function CalendarHistory({ history = {}, now, project, onUpdate, cloud }: Props) {
  const today = localDate(now);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const [tabStop, setTabStop] = useState(today);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusRequested = useRef(false);
  const cells = monthCells(month);
  const snapshot = selected ? history[selected] : undefined;
  const versionId = selected ? project.mediaHistory?.[selected] : undefined;
  const media = project.mediaVersions?.find((item) => item.id === versionId);
  const recorded = (date: string) => project.kind === "visual" || project.kind === "music" ? !!project.mediaHistory?.[date] : !!history[date];
  const [confirm, setConfirm] = useState(false);
  const [year, monthNumber] = month.split("-").map(Number);

  useEffect(() => {
    if (focusRequested.current) {
      dayRefs.current.get(tabStop)?.focus();
      focusRequested.current = false;
    }
  }, [tabStop, month]);

  function moveMonth(delta: number) {
    const next = adjacentMonth(month, delta);
    setMonth(next);
    setSelected(null);
    setTabStop(next === today.slice(0, 7) ? today : `${next}-01`);
  }
  function navigateDay(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const parsed = parseLocalDate(date)!;
    const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1
      : event.key === "ArrowDown" ? 7 : event.key === "ArrowUp" ? -7
      : event.key === "Home" ? -parsed.getDay() : event.key === "End" ? 6 - parsed.getDay() : null;
    if (offset === null) return;
    event.preventDefault();
    const next = dateAfter(offset, parsed);
    if (!parseLocalDate(next)) return;
    if (next === tabStop) { focusRequested.current = false; return; }
    focusRequested.current = true;
    setMonth(next.slice(0, 7));
    setTabStop(next);
  }

  return <section className="calendar-history" aria-labelledby="history-heading">
    <div className="section-heading"><h2 id="history-heading">나의 기록</h2><span className="section-label">CALENDAR HISTORY</span></div>
    <div className="calendar-month-navigation">
      <button type="button" className="calendar-nav" aria-label="이전 달" disabled={month === "2000-01"} onClick={() => moveMonth(-1)}>‹</button>
      <h3 aria-live="polite">{year}년 {monthNumber}월</h3>
      <button type="button" className="calendar-nav" aria-label="다음 달" disabled={month === "9999-12"} onClick={() => moveMonth(1)}>›</button>
      <button type="button" className="calendar-today" onClick={() => { setMonth(today.slice(0, 7)); setTabStop(today); setSelected(null); }}>오늘</button>
    </div>
    <table className="history-calendar">
      <caption className="sr-only">창작 기록 달력. 방향키로 날짜 이동, Enter 또는 Space로 기록 조회.</caption>
      <thead><tr>{WEEKDAYS.map((day) => <th key={day} scope="col">{day}</th>)}</tr></thead>
      <tbody>{Array.from({ length: 6 }, (_, week) => <tr key={week}>
        {cells.slice(week * 7, week * 7 + 7).map((date, index) => <td key={date ?? `blank-${index}`}>
          {date && <button type="button"
            ref={(element) => { if (element) dayRefs.current.set(date, element); else dayRefs.current.delete(date); }}
            className="calendar-day" data-recorded={recorded(date)}
            aria-label={`${formatDate(date)}${recorded(date) ? ", 저장 기록 있음" : ", 기록 없음"}`}
            aria-current={date === today ? "date" : undefined} aria-pressed={selected === date}
            tabIndex={date === tabStop ? 0 : -1}
            onKeyDown={(event) => navigateDay(event, date)}
            onClick={() => { setSelected(date); setTabStop(date); setConfirm(false); }}
          ><span>{Number(date.slice(-2))}</span>{recorded(date) && <span className="calendar-record-dot" aria-hidden="true" />}</button>}
        </td>)}
      </tr>)}</tbody>
    </table>
    <div className="calendar-legend"><span><i aria-hidden="true" />작품 저장한 날</span><span>방문만 한 날은 표시하지 않아요.</span></div>
    {selected ? <div className="history-preview">
      <div className="history-preview-heading"><h3 aria-live="polite">{formatDate(selected)}</h3><button type="button" className="text-button" onClick={() => setSelected(null)}>기록 닫기</button></div>
      {media ? <><p className="history-saved-at">이날의 대표 버전 · {media.filename}</p><MediaPreview version={media} cloud={cloud} /><p className="history-readonly-note">과거 버전 조회 · 현재 작업물은 바뀌지 않아요.</p></> : snapshot && (project.kind ?? "writing") === "writing" ? <>
        <p className="history-saved-at">이날의 마지막 저장 · {formatInstant(snapshot.savedAt)}</p>
        {snapshot.content ? <><label className="sr-only" htmlFor="snapshot-content">선택한 날짜의 작품 기록</label><textarea id="snapshot-content" readOnly value={snapshot.content} className="snapshot-content" rows={6} /></>
          : <p className="empty-history">이날 본문을 모두 비운 상태로 저장했어요.</p>}
        <p className="history-readonly-note">읽기 전용 · 과거 기록을 보고 있어요. 현재 작업물은 바뀌지 않습니다.</p>
        {snapshot.content !== (project.workspace?.content ?? "") && <button type="button" className="text-button" onClick={() => setConfirm(true)}>이 원고로 복원하기</button>}
        {confirm && <div className="restore-confirm" role="group" aria-label="원고 복원 확인"><p>현재 원고를 별도 백업한 뒤 이 기록으로 복원합니다.</p><button type="button" className="text-button" onClick={() => setConfirm(false)}>취소</button><button type="button" className="small-button" onClick={() => { if (onUpdate((p) => restoreWriting(p, snapshot))) setConfirm(false); }}>백업하고 복원</button></div>}
      </> : <p className="empty-history">이날 저장한 작품 기록은 없어요.</p>}
    </div> : <p className="calendar-hint">날짜를 선택하면 그날 저장한 작품을 볼 수 있어요.</p>}
  </section>;
}
