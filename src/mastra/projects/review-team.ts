export type ProjectReviewTeam = {
  piUsername?: string | null;
  pdraUsername?: string | null;
  piUsernames?: string[];
  pdraUsernames?: string[];
};

// Legacy records and saved single-reviewer snapshots keep their original shape.
export function projectPIs(project: ProjectReviewTeam): string[] {
  return project.piUsernames ?? (project.piUsername ? [project.piUsername] : []);
}

export function projectPDRAs(project: ProjectReviewTeam): string[] {
  return project.pdraUsernames ?? (project.pdraUsername ? [project.pdraUsername] : []);
}
