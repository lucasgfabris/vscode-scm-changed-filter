export const VISIBILITY_COMMAND_PATTERN = /^workbench\.scm\.action\.toggleRepositoryVisibility\.scm(\d+)$/;

export interface GitState {
  readonly HEAD: unknown;
  readonly mergeChanges: readonly unknown[];
  readonly indexChanges: readonly unknown[];
  readonly workingTreeChanges: readonly unknown[];
  readonly untrackedChanges: readonly unknown[];
}

export function countChanges(state: GitState): number {
  return (
    state.mergeChanges.length +
    state.indexChanges.length +
    state.workingTreeChanges.length +
    state.untrackedChanges.length
  );
}

export function hasChanges(state: GitState): boolean {
  // Without HEAD the first status has not loaded yet, so empty arrays do not mean "clean".
  if (state.HEAD === undefined) return true;
  return countChanges(state) > 0;
}

export function handleFromCommand(id: string): number | undefined {
  const match = VISIBILITY_COMMAND_PATTERN.exec(id);
  return match ? Number(match[1]) : undefined;
}

export function normalizeRoot(fsPath: string, platform: string = process.platform): string {
  return platform === 'win32' ? fsPath.toLowerCase() : fsPath;
}

export interface Toggle {
  readonly root: string;
  readonly command: string;
  readonly hide: boolean;
}

export function requiredToggles(
  hidden: ReadonlySet<string>,
  desiredVisible: ReadonlyMap<string, boolean>,
  commands: ReadonlyMap<string, string>,
): Toggle[] {
  const toggles: Toggle[] = [];
  for (const [root, visible] of desiredVisible) {
    const command = commands.get(root);
    if (!command) continue;
    if (visible === hidden.has(root)) toggles.push({ root, command, hide: !visible });
  }
  return toggles;
}

export type SelectionMode = 'single' | 'multiple';

export interface SelectionModeInspection {
  readonly defaultValue?: SelectionMode;
  readonly globalValue?: SelectionMode;
  readonly workspaceValue?: SelectionMode;
}

export type ResetPlan =
  | { readonly blocked: true }
  | { readonly blocked: false; readonly target: 'global' | 'workspace'; readonly original: SelectionMode | undefined };

export function planReset(inspection: SelectionModeInspection): ResetPlan {
  const effective = inspection.workspaceValue ?? inspection.globalValue ?? inspection.defaultValue ?? 'multiple';
  if (effective === 'single') return { blocked: true };
  // Write at the level that defines the effective value; writing below it changes nothing.
  if (inspection.workspaceValue !== undefined) {
    return { blocked: false, target: 'workspace', original: inspection.workspaceValue };
  }
  return { blocked: false, target: 'global', original: inspection.globalValue };
}

export function matchByOrder(handles: readonly number[], roots: readonly string[]): Map<number, string> | undefined {
  if (handles.length === 0 || handles.length !== roots.length) return undefined;
  const sorted = [...handles].sort((a, b) => a - b);
  return new Map(sorted.map((handle, i) => [handle, roots[i]]));
}
