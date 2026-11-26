import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countChanges,
  GitState,
  handleFromCommand,
  hasChanges,
  matchByOrder,
  normalizeRoot,
  planReset,
  requiredToggles,
} from '../logic';

function state(partial: Partial<GitState> = {}): GitState {
  return {
    HEAD: { name: 'main' },
    mergeChanges: [],
    indexChanges: [],
    workingTreeChanges: [],
    untrackedChanges: [],
    ...partial,
  };
}

test('countChanges: nothing changed is zero', () => {
  assert.equal(countChanges(state()), 0);
});

test('hasChanges: each kind of change counts on its own', () => {
  assert.equal(hasChanges(state({ indexChanges: [1] })), true);
  assert.equal(hasChanges(state({ workingTreeChanges: [1] })), true);
  assert.equal(hasChanges(state({ untrackedChanges: [1] })), true);
  assert.equal(hasChanges(state({ mergeChanges: [1] })), true);
});

test('hasChanges: clean repository with loaded status has no changes', () => {
  assert.equal(hasChanges(state()), false);
});

test('hasChanges: repository whose status has not loaded counts as changed', () => {
  assert.equal(hasChanges(state({ HEAD: undefined })), true);
});

test('handleFromCommand: extracts the number from the visibility command', () => {
  assert.equal(handleFromCommand('workbench.scm.action.toggleRepositoryVisibility.scm12'), 12);
  assert.equal(handleFromCommand('workbench.scm.action.toggleRepositoryVisibility.scm0'), 0);
});

test('handleFromCommand: ignores other commands', () => {
  assert.equal(handleFromCommand('workbench.scm.action.toggleRepositoryVisibility'), undefined);
  assert.equal(handleFromCommand('git.commit'), undefined);
  assert.equal(handleFromCommand('workbench.scm.action.toggleRepositoryVisibility.scm1.extra'), undefined);
});

test('normalizeRoot: case-insensitive on Windows, case-sensitive on Linux', () => {
  assert.equal(normalizeRoot('D:\\Repo', 'win32'), normalizeRoot('d:\\repo', 'win32'));
  assert.notEqual(normalizeRoot('/home/Repo', 'linux'), normalizeRoot('/home/repo', 'linux'));
});

const commands = new Map([
  ['a', 'cmd.a'],
  ['b', 'cmd.b'],
]);

test('requiredToggles: nothing to do when the model matches the desired state', () => {
  const desired = new Map([
    ['a', true],
    ['b', false],
  ]);
  assert.deepEqual(requiredToggles(new Set(['b']), desired, commands), []);
});

test('requiredToggles: hidden repository that got changes is shown', () => {
  const toggles = requiredToggles(new Set(['a']), new Map([['a', true]]), commands);
  assert.deepEqual(toggles, [{ root: 'a', command: 'cmd.a', hide: false }]);
});

test('requiredToggles: visible repository that became clean is hidden', () => {
  const toggles = requiredToggles(new Set(), new Map([['b', false]]), commands);
  assert.deepEqual(toggles, [{ root: 'b', command: 'cmd.b', hide: true }]);
});

test('requiredToggles: root without a mapped command is ignored', () => {
  assert.deepEqual(requiredToggles(new Set(), new Map([['c', false]]), commands), []);
});

test('planReset: default only writes to global and removes the key afterwards', () => {
  assert.deepEqual(planReset({ defaultValue: 'multiple' }), { blocked: false, target: 'global', original: undefined });
});

test('planReset: global value is preserved', () => {
  assert.deepEqual(planReset({ defaultValue: 'multiple', globalValue: 'multiple' }), {
    blocked: false,
    target: 'global',
    original: 'multiple',
  });
});

test('planReset: workspace value writes to workspace', () => {
  assert.deepEqual(planReset({ defaultValue: 'multiple', globalValue: 'single', workspaceValue: 'multiple' }), {
    blocked: false,
    target: 'workspace',
    original: 'multiple',
  });
});

test('planReset: effective single mode blocks the filter', () => {
  assert.deepEqual(planReset({ defaultValue: 'multiple', globalValue: 'single' }), { blocked: true });
  assert.deepEqual(planReset({ globalValue: 'multiple', workspaceValue: 'single' }), { blocked: true });
});

test('matchByOrder: pairs handles in ascending order with the roots', () => {
  assert.deepEqual(
    matchByOrder([5, 2], ['x', 'y']),
    new Map([
      [2, 'x'],
      [5, 'y'],
    ]),
  );
});

test('matchByOrder: different counts do not match', () => {
  assert.equal(matchByOrder([1, 2, 3], ['x', 'y']), undefined);
  assert.equal(matchByOrder([], []), undefined);
});
