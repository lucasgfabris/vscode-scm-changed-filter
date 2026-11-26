import * as vscode from 'vscode';
import { planReset, requiredToggles, SelectionMode, SelectionModeInspection } from './logic';

const HIDDEN_KEY = 'scmChangedFilter.hidden';
const SECTION = 'scm.repositories';
const SETTING = 'selectionMode';
const SETTING_CHANGE_TIMEOUT_MS = 2000;
const SETTING_CHANGE_GRACE_MS = 150;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tracks which repositories this extension has hidden. VS Code offers no way to read a repository's
 * visibility, and its command only toggles, so this model is the source of truth.
 */
export class Visibility {
  private readonly hidden: Set<string>;

  constructor(
    private readonly workspaceState: vscode.Memento,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.hidden = new Set(workspaceState.get<string[]>(HIDDEN_KEY, []));
  }

  isSingleMode(): boolean {
    return planReset(this.inspectMode()).blocked;
  }

  async apply(desiredVisible: ReadonlyMap<string, boolean>, commands: ReadonlyMap<string, string>): Promise<void> {
    const toggles = requiredToggles(this.hidden, desiredVisible, commands);
    if (toggles.length === 0) return;
    for (const { root, command, hide } of toggles) {
      await vscode.commands.executeCommand(command);
      if (hide) this.hidden.add(root);
      else this.hidden.delete(root);
      this.log.info(`${hide ? 'hidden' : 'shown'}: ${root}`);
    }
    await this.save();
  }

  /** Makes every repository visible and clears the model. */
  async reset(providerCount: number, commands: ReadonlyMap<string, string>): Promise<void> {
    if (providerCount >= 2) {
      await this.resetViaSetting();
    } else {
      // With a single provider VS Code ignores selectionMode changes, so rely on the saved model.
      for (const root of this.hidden) {
        const command = commands.get(root);
        if (command) await vscode.commands.executeCommand(command);
      }
    }
    await this.clear();
  }

  async forget(root: string): Promise<void> {
    if (this.hidden.delete(root)) await this.save();
  }

  async clear(): Promise<void> {
    this.hidden.clear();
    await this.save();
  }

  private async resetViaSetting(): Promise<void> {
    const plan = planReset(this.inspectMode());
    if (plan.blocked) throw new Error('scm.repositories.selectionMode is set to "single"');
    const target = plan.target === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    // Switching to single and back makes VS Code show every repository again.
    await this.writeMode('single', target);
    await this.writeMode(plan.original, target);
    this.log.info('reset: all repositories visible');
  }

  private async writeMode(value: SelectionMode | undefined, target: vscode.ConfigurationTarget): Promise<void> {
    let listener: vscode.Disposable | undefined;
    const changed = new Promise<void>((resolve) => {
      listener = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SECTION}.${SETTING}`)) resolve();
      });
    });
    try {
      await vscode.workspace.getConfiguration(SECTION).update(SETTING, value, target);
      await Promise.race([changed, delay(SETTING_CHANGE_TIMEOUT_MS)]);
      await delay(SETTING_CHANGE_GRACE_MS);
    } finally {
      listener?.dispose();
    }
  }

  private inspectMode(): SelectionModeInspection {
    return vscode.workspace.getConfiguration(SECTION).inspect<SelectionMode>(SETTING) ?? {};
  }

  private save(): Thenable<void> {
    return this.workspaceState.update(HIDDEN_KEY, [...this.hidden]);
  }
}
