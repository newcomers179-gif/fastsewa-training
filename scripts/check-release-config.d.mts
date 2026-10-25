export function apiUrlProblem(value: unknown): string | null;
export function checkRelease(options?: { root?: string; profile?: string | null; env?: Record<string, string | undefined> }): { errors: string[]; warnings: string[] };
