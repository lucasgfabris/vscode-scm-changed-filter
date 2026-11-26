import * as vscode from 'vscode';
import { Git } from './git';
import { Mapping } from './mapping';
import { Visibility } from './visibility';

const ENABLED_KEY = 'scmChangedFilter.enabled';
const DEBOUNCE_MS = 500;
const COMMAND_POLL_INTERVAL_MS = 2000;
const SCM_SETTLE_DELAY_MS = 5000;

const SINGLE_MODE_MESSAGE = 'SCM Changed Filter requires scm.repositories.selectionMode to be "multiple".';
const UNAVAILABLE_MESSAGE = 'SCM Changed Filter is not available in this version of VS Code.';

class FilterUnavailable extends Error {}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class Filter implements vscode.Disposable {
  private enabled: boolean;
  private ready = false;
  private queue: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  private warnedUnavailable = false;

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly git: Git,
    private readonly mapping: Mapping,
    private readonly visibility: Visibility,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.enabled = globalState.get<boolean>(ENABLED_KEY, false);
  }

  async start(): Promise<void> {
    await this.publishContext();
    this.git.listen({
      onStatusChange: () => this.schedule(),
      onOpen: (root) => this.onOpen(root),
      onClose: (root) => this.onClose(root),
    });
    await this.git.waitUntilInitialized();

    if (!this.enabled || this.git.roots().length === 0) {
      this.ready = true;
      return;
    }

    // The visibility commands only exist once Source Control has been rendered in this session, and the
    // state VS Code restores only settles after its own 5 s debounce.
    while (this.enabled && (await this.mapping.availableHandles()).length === 0) {
      await delay(COMMAND_POLL_INTERVAL_MS);
    }
    await delay(SCM_SETTLE_DELAY_MS);

    await this.enqueue(async () => {
      if (!this.enabled) return;
      if (this.visibility.isSingleMode()) {
        await this.setEnabled(false);
        void vscode.window.showWarningMessage(SINGLE_MODE_MESSAGE);
        return;
      }
      const handles = await this.map();
      if (handles.length >= 2) await this.visibility.reset(handles.length, this.mapping.commands());
      await this.apply();
    });
    this.ready = true;
  }

  async enable(): Promise<void> {
    if (this.visibility.isSingleMode()) {
      void vscode.window.showWarningMessage(SINGLE_MODE_MESSAGE);
      return;
    }
    await this.setEnabled(true);
    this.ready = true;
    await this.enqueue(() => this.resyncAndApply());
  }

  async disable(): Promise<void> {
    await this.setEnabled(false);
    await this.enqueue(() => this.reset());
  }

  async resync(): Promise<void> {
    await this.enqueue(() => (this.enabled ? this.resyncAndApply() : this.reset()));
  }

  private onOpen(root: string): void {
    if (!this.enabled || !this.ready) return;
    // The new repository's visibility command is registered by the renderer with a delay.
    void this.enqueue(() => this.mapping.refreshUntilFound(this.git.roots(), root));
    this.schedule();
  }

  private onClose(root: string): void {
    if (!this.enabled || !this.ready) return;
    void this.enqueue(async () => {
      await this.visibility.forget(root);
      const handles = await this.mapping.refresh(this.git.roots());
      const remaining = handles.filter((h) => this.mapping.rootOfHandle(h) !== root).length;
      // If no repository is left visible, VS Code shows one on its own. A reset brings back a known
      // state; with a single one left, it is the one VS Code just showed.
      if (remaining >= 2) await this.visibility.reset(remaining, this.mapping.commands());
      else await this.visibility.clear();
      await this.apply();
    });
  }

  private schedule(): void {
    if (!this.enabled || !this.ready) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.enqueue(() => this.apply()), DEBOUNCE_MS);
  }

  private async resyncAndApply(): Promise<void> {
    const handles = await this.map();
    await this.visibility.reset(handles.length, this.mapping.commands());
    await this.apply();
  }

  private async apply(): Promise<void> {
    if (!this.enabled) return;
    await this.visibility.apply(this.git.desiredVisibility(), this.mapping.commands());
  }

  private async reset(): Promise<void> {
    const handles = await this.mapping.refresh(this.git.roots());
    await this.visibility.reset(handles.length, this.mapping.commands());
  }

  private async map(): Promise<number[]> {
    const roots = this.git.roots();
    const handles = await this.mapping.refresh(roots);
    if (roots.length > 0 && (handles.length === 0 || this.mapping.commands().size === 0)) {
      throw new FilterUnavailable();
    }
    return handles;
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task).catch((error: unknown) => this.handleError(error));
    this.queue = next;
    return next;
  }

  private async handleError(error: unknown): Promise<void> {
    if (error instanceof FilterUnavailable) {
      this.log.error(UNAVAILABLE_MESSAGE);
      if (!this.warnedUnavailable) {
        this.warnedUnavailable = true;
        void vscode.window.showWarningMessage(UNAVAILABLE_MESSAGE);
      }
      await this.setEnabled(false);
      try {
        await this.reset();
      } catch (resetError) {
        this.log.error(`reset after failure: ${String(resetError)}`);
      }
      return;
    }
    this.log.error(String(error));
    void vscode.window.showErrorMessage(`SCM Changed Filter: ${error instanceof Error ? error.message : String(error)}`);
  }

  private async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    if (!enabled) clearTimeout(this.timer);
    await this.globalState.update(ENABLED_KEY, enabled);
    await this.publishContext();
  }

  private async publishContext(): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'scmChangedFilter.enabled', this.enabled);
  }

  dispose(): void {
    clearTimeout(this.timer);
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel('SCM Changed Filter', { log: true });
  const mapping = new Mapping(log);
  context.subscriptions.push(log, mapping.registerProbe());

  let git: Git;
  try {
    git = await Git.get();
  } catch (error) {
    log.error(`Git is unavailable: ${String(error)}`);
    return;
  }

  const filter = new Filter(context.globalState, git, mapping, new Visibility(context.workspaceState, log), log);
  context.subscriptions.push(
    git,
    filter,
    vscode.commands.registerCommand('scmChangedFilter.enable', () => filter.enable()),
    vscode.commands.registerCommand('scmChangedFilter.disable', () => filter.disable()),
    vscode.commands.registerCommand('scmChangedFilter.resync', () => filter.resync()),
  );

  void filter.start().catch((error: unknown) => log.error(`startup: ${String(error)}`));
}

export function deactivate(): void {}
