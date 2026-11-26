import * as vscode from 'vscode';
import { GitState, hasChanges, normalizeRoot } from './logic';

// Subset of extensions/git/src/api/git.d.ts used by this extension.
interface RepositoryState extends GitState {
  readonly onDidChange: vscode.Event<void>;
}

interface Repository {
  readonly rootUri: vscode.Uri;
  readonly state: RepositoryState;
}

interface GitAPI {
  readonly state: 'uninitialized' | 'initialized';
  readonly onDidChangeState: vscode.Event<'uninitialized' | 'initialized'>;
  readonly repositories: Repository[];
  readonly onDidOpenRepository: vscode.Event<Repository>;
  readonly onDidCloseRepository: vscode.Event<Repository>;
}

interface GitExtension {
  getAPI(version: 1): GitAPI;
}

export interface GitListeners {
  onStatusChange(): void;
  onOpen(root: string): void;
  onClose(root: string): void;
}

function rootOf(repository: Repository): string {
  return normalizeRoot(repository.rootUri.fsPath);
}

export class Git implements vscode.Disposable {
  private readonly listenersByRoot = new Map<string, vscode.Disposable>();
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(private readonly api: GitAPI) {}

  static async get(): Promise<Git> {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) throw new Error('the built-in Git extension was not found');
    const exports = extension.isActive ? extension.exports : await extension.activate();
    return new Git(exports.getAPI(1));
  }

  async waitUntilInitialized(): Promise<void> {
    if (this.api.state === 'initialized') return;
    await new Promise<void>((resolve) => {
      const listener = this.api.onDidChangeState((state) => {
        if (state !== 'initialized') return;
        listener.dispose();
        resolve();
      });
    });
  }

  roots(): string[] {
    return this.api.repositories.map(rootOf);
  }

  desiredVisibility(): Map<string, boolean> {
    return new Map(this.api.repositories.map((repository) => [rootOf(repository), hasChanges(repository.state)]));
  }

  listen(listeners: GitListeners): void {
    for (const repository of this.api.repositories) this.listenTo(repository, listeners);
    this.disposables.push(
      this.api.onDidOpenRepository((repository) => {
        this.listenTo(repository, listeners);
        listeners.onOpen(rootOf(repository));
      }),
      this.api.onDidCloseRepository((repository) => {
        const root = rootOf(repository);
        this.listenersByRoot.get(root)?.dispose();
        this.listenersByRoot.delete(root);
        listeners.onClose(root);
      }),
    );
  }

  private listenTo(repository: Repository, listeners: GitListeners): void {
    const root = rootOf(repository);
    this.listenersByRoot.get(root)?.dispose();
    this.listenersByRoot.set(root, repository.state.onDidChange(() => listeners.onStatusChange()));
  }

  dispose(): void {
    for (const listener of this.listenersByRoot.values()) listener.dispose();
    this.listenersByRoot.clear();
    for (const disposable of this.disposables) disposable.dispose();
  }
}
