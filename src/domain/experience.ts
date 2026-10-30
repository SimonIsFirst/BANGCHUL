import { STEPS } from "./project.ts";
import type { LocalState } from "./project.ts";

export const ONBOARDING_SCENES = ["opening", ...STEPS] as const;

export function nextScene(step: LocalState["step"]): LocalState["step"] {
  const index = ONBOARDING_SCENES.indexOf(step);
  return ONBOARDING_SCENES[Math.min(index + 1, ONBOARDING_SCENES.length - 1)];
}

export function previousScene(step: LocalState["step"]): LocalState["step"] {
  const index = ONBOARDING_SCENES.indexOf(step);
  return ONBOARDING_SCENES[Math.max(index - 1, 0)];
}

/** Explicit, deterministic review settings; never randomly assign visitors. */
export function readExperience(search: string) {
  const params = new URLSearchParams(search);
  return {
    design: params.get("design") === "minimal" ? "minimal" : "cinematic",
    preview: params.get("preview") === "1",
  } as const;
}
