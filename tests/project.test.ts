import test from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  dateAfter,
  daysUntil,
  deadlineError,
  emptyState,
  parseLocalDate,
  projectStatus,
  validateStep,
} from "../src/domain/project.ts";

test("required input rejects whitespace; multiline text is accepted", () => {
  const draft = emptyState().draft;
  assert.ok(validateStep("name", { ...draft, name: "  " }));
  assert.ok(validateStep("title", { ...draft, title: "\n" }));
  assert.ok(validateStep("description", { ...draft, description: "" }));
  assert.equal(
    validateStep("description", {
      ...draft,
      description: "사진 열 장.\n짧은 글 열 편.",
    }),
    null,
  );
  assert.ok(validateStep("agreement", draft));
});

test("deadline rejects past and impossible calendar dates, accepts today", () => {
  const now = new Date(2026, 9, 11, 23, 58);
  assert.ok(deadlineError("2026-10-10", now));
  assert.ok(deadlineError("2026-02-30", now));
  assert.ok(deadlineError("2026-10-11T12:00", now));
  assert.equal(deadlineError("2026-10-11", now), null);
  assert.equal(parseLocalDate("2025-02-29"), null);
  assert.ok(parseLocalDate("2028-02-29"));
});

test("presets and D-Day use calendar days, including midnight and year boundaries", () => {
  const now = new Date(2026, 11, 31, 23, 59);
  assert.equal(dateAfter(7, now), "2027-01-07");
  assert.equal(daysUntil("2027-01-01", now), 1);
  assert.equal(daysUntil("2026-12-31", now), 0);
  assert.equal(daysUntil("2026-12-30", now), -1);
});

test("D-Day remains correct across a daylight-saving change", () => {
  const originalZone = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    assert.equal(daysUntil("2026-03-09", new Date(2026, 2, 7, 23, 50)), 2);
    assert.equal(dateAfter(7, new Date(2026, 2, 7)), "2026-03-14");
  } finally {
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
  }
});

test("creation requires consent, trims inputs and stores an explicit end-of-day instant", () => {
  const draft = {
    name: " Simon ",
    title: " 필름 사진집 ",
    description: " 나의 하루를 담아요. ",
    releaseDate: "2026-10-18",
    agreed: true,
  };
  const project = createProject(draft, new Date(2026, 9, 11, 12));
  assert.equal(project.name, "Simon");
  assert.equal(project.title, "필름 사진집");
  assert.equal(new Date(project.releaseAt).getHours(), 23);
  assert.equal(new Date(project.releaseAt).getMinutes(), 59);
  assert.throws(() =>
    createProject({ ...draft, agreed: false }, new Date(2026, 9, 11)),
  );
  assert.throws(() =>
    createProject(
      { ...draft, releaseDate: "2026-10-10" },
      new Date(2026, 9, 11),
    ),
  );
  assert.equal(
    projectStatus(project, new Date(project.releaseAt)),
    "예정일 지남 · 아직 비공개",
  );
  assert.equal(project.notes.length, 0);
});
