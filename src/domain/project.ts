export const NAME_LIMIT = 40;
export const TITLE_LIMIT = 100;
export const DESCRIPTION_LIMIT = 1000;
export const NOTE_LIMIT = 2000;
export const WORKSPACE_LIMIT = 500_000;

export type Step = "name" | "title" | "description" | "transition" | "deadline" | "agreement";
export const STEPS: readonly Step[] = [
  "name",
  "title",
  "description",
  "transition",
  "deadline",
  "agreement",
];

export interface Draft {
  name: string;
  title: string;
  description: string;
  startDate?: string;
  releaseDate: string;
  agreed: boolean;
}

export interface Note {
  id: string;
  text: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  title: string;
  description: string;
  startedAt: string;
  startDate?: string;
  releaseDate: string;
  releaseAt: string;
  timeZone: string;
  updatedAt: string;
  notes: Note[];
  workspace?: CreativeWorkspace;
  history?: Record<string, DailySnapshot>;
}

export interface CreativeWorkspace {
  content: string;
  updatedAt: string;
}

export interface DailySnapshot {
  date: string;
  content: string;
  savedAt: string;
}

export interface LocalState {
  version: 1;
  draft: Draft;
  step: Step | "opening";
  project: Project | null;
}

export function emptyState(): LocalState {
  return {
    version: 1,
    draft: {
      name: "",
      title: "",
      description: "",
      releaseDate: "",
      agreed: false,
    },
    step: "opening",
    project: null,
  };
}

export function localDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parse calendar dates locally; UTC string parsing shifts dates in some zones. */
export function parseLocalDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 2000 || year > 9999) return null;
  const date = new Date(year, month - 1, day);
  return localDate(date) === value ? date : null;
}

export function dateAfter(days: number, now = new Date()): string {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

export function daysUntil(value: string, now = new Date()): number {
  const target = parseLocalDate(value);
  if (!target) return 0;
  // Calendar-day arithmetic, independent of 23/25-hour daylight-saving days.
  const targetDay = Date.UTC(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
  );
  const currentDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((targetDay - currentDay) / 86_400_000);
}

export function deadlineError(value: string, now = new Date()): string | null {
  if (!value) return "공개할 날짜를 선택해주세요.";
  if (!parseLocalDate(value)) return "올바른 날짜를 입력해주세요.";
  if (daysUntil(value, now) < 0) return "오늘 이후의 날짜를 선택해주세요.";
  return null;
}

export function validateStep(
  step: Step,
  draft: Draft,
  now = new Date(),
): string | null {
  if (step === "name") {
    if (!draft.name.trim()) return "이름 또는 활동명을 입력해주세요.";
    if (draft.name.trim().length > NAME_LIMIT)
      return `이름은 ${NAME_LIMIT}자 이내로 입력해주세요.`;
  }
  if (step === "title") {
    if (!draft.title.trim()) return "만들고 싶은 작품의 이름을 입력해주세요.";
    if (draft.title.trim().length > TITLE_LIMIT)
      return `작품 이름은 ${TITLE_LIMIT}자 이내로 입력해주세요.`;
  }
  if (step === "description") {
    if (!draft.description.trim()) return "어떤 작품인지 한 문장만 적어주세요.";
    if (draft.description.trim().length > DESCRIPTION_LIMIT)
      return `설명은 ${DESCRIPTION_LIMIT}자 이내로 입력해주세요.`;
  }
  if (step === "deadline") {
    if (draft.startDate) {
      if (!parseLocalDate(draft.startDate))
        return "올바른 시작일을 입력해주세요.";
      if (daysUntil(draft.startDate, now) < 0)
        return "시작일은 오늘 이후로 정해주세요.";
    }
    const error = deadlineError(draft.releaseDate, now);
    if (error) return error;
    if (draft.startDate && draft.releaseDate < draft.startDate)
      return "종료일은 시작일과 같거나 이후여야 해요.";
  }
  if (step === "agreement" && !draft.agreed)
    return "안내를 확인하고 동의해주세요.";
  return null;
}

export function createProject(draft: Draft, now = new Date()): Project {
  for (const step of STEPS) {
    const error = validateStep(step, draft, now);
    if (error) throw new Error(error);
  }
  const release = parseLocalDate(draft.releaseDate)!;
  release.setHours(23, 59, 0, 0);
  return {
    id: crypto.randomUUID(),
    name: draft.name.trim(),
    title: draft.title.trim(),
    description: draft.description.trim(),
    startedAt: now.toISOString(),
    startDate: draft.startDate || localDate(now),
    releaseDate: draft.releaseDate,
    releaseAt: release.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    updatedAt: now.toISOString(),
    notes: [],
  };
}

export function formatDate(value: string): string {
  const date = parseLocalDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function formatInstant(value: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(value));
}

export function ddayLabel(days: number): string {
  if (days > 0) return `D−${days}`;
  if (days === 0) return "D-DAY";
  return `D+${Math.abs(days)}`;
}

export function projectStatus(project: Project, now = new Date()): string {
  if (now.getTime() >= new Date(project.releaseAt).getTime())
    return "예정일 지남 · 아직 비공개";
  if (project.startDate && daysUntil(project.startDate, now) > 0)
    return "시작 예정 · 비공개";
  if (daysUntil(localDate(new Date(project.releaseAt)), now) === 0)
    return "오늘이 예정일 · 비공개";
  return "창작 중 · 비공개";
}
