import * as vscode from 'vscode';
import { handleFromCommand, matchByOrder, normalizeRoot } from './logic';

const PROBE_COMMAND = 'scmChangedFilter._probe';
const VISIBILITY_COMMAND_PREFIX = 'workbench.scm.action.toggleRepositoryVisibility.scm';
const NEW_REPOSITORY_RETRY_DELAYS_MS = [200, 400, 800, 1600, 3200];

const NOT_GIT = null;
const PROBE_FAILED = undefined;
type ProbeResult = string | typeof NOT_GIT | typeof PROBE_FAILED;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Maps each `toggleRepositoryVisibility.scm<N>` command to the Git repository root it controls. */
export class Mapping {
  // Handles are never reused within a session, so a probe result stays valid until its command disappears.
  private readonly rootByHandle = new Map<number, string | null>();
  private received: unknown;

  constructor(private readonly log: vscode.LogOutputChannel) {}

  registerProbe(): vscode.Disposable {
    return vscode.commands.registerCommand(PROBE_COMMAND, (argument: unknown) => {
      this.received = argument;
    });
  }

  async availableHandles(): Promise<number[]> {
    const all = await vscode.commands.getCommands(true);
    const handles: number[] = [];
    for (const id of all) {
      const handle = handleFromCommand(id);
      if (handle !== undefined) handles.push(handle);
    }
    return handles.sort((a, b) => a - b);
  }

  /** Probes new handles and returns every handle that currently exists. */
  async refresh(gitRoots: readonly string[]): Promise<number[]> {
    const handles = await this.availableHandles();
    const existing = new Set(handles);
    for (const handle of this.rootByHandle.keys()) {
      if (!existing.has(handle)) this.rootByHandle.delete(handle);
    }

    let anyFailed = false;
    for (const handle of handles) {
      if (this.rootByHandle.has(handle)) continue;
      const result = await this.probe(handle);
      if (result === PROBE_FAILED) {
        anyFailed = true;
        this.log.warn(`scm${handle}: the probe did not receive a SourceControl`);
      } else {
        this.rootByHandle.set(handle, result);
        this.log.info(`scm${handle} → ${result ?? '(not git)'}`);
      }
    }

    if (anyFailed) this.matchByOrder(handles, gitRoots);
    return handles;
  }

  async refreshUntilFound(gitRoots: readonly string[], root: string): Promise<void> {
    for (const ms of NEW_REPOSITORY_RETRY_DELAYS_MS) {
      await delay(ms);
      await this.refresh(gitRoots);
      if (this.commands().has(root)) return;
    }
    this.log.warn(`no visibility command found for ${root}`);
  }

  rootOfHandle(handle: number): string | null | undefined {
    return this.rootByHandle.get(handle);
  }

  commands(): Map<string, string> {
    const commands = new Map<string, string>();
    for (const [handle, root] of this.rootByHandle) {
      if (root) commands.set(root, `${VISIBILITY_COMMAND_PREFIX}${handle}`);
    }
    return commands;
  }

  private async probe(handle: number): Promise<ProbeResult> {
    this.received = undefined;
    try {
      // `{ $mid: 5 }` is MarshalledId.ScmProvider. Going through runCommands sends the argument to the
      // renderer and back, and the extension host revives it into the real SourceControl for the probe.
      await vscode.commands.executeCommand('runCommands', {
        commands: [{ command: PROBE_COMMAND, args: { $mid: 5, handle } }],
      });
    } catch (error) {
      this.log.warn(`scm${handle}: probe error: ${String(error)}`);
      return PROBE_FAILED;
    }
    const sourceControl = this.received as Partial<vscode.SourceControl> | undefined;
    if (!sourceControl?.rootUri) return PROBE_FAILED;
    return sourceControl.id === 'git' ? normalizeRoot(sourceControl.rootUri.fsPath) : NOT_GIT;
  }

  private matchByOrder(handles: readonly number[], gitRoots: readonly string[]): void {
    // Fallback: handles are sequential and the Git extension creates its SourceControls in repository order.
    const matched = matchByOrder(handles, gitRoots);
    if (!matched) return;
    for (const [handle, root] of matched) this.rootByHandle.set(handle, root);
    this.log.info('mapped by repository order (fallback)');
  }
}
