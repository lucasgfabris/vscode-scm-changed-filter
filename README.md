# SCM Changed Filter

A button in the VS Code Source Control header that toggles between showing every Git repository and
showing only the ones with changes (staged, unstaged, untracked or merge conflicts). It uses the
native tree, so commit, stage, discard, push and everything else keep working as usual.

Useful for multi-root workspaces with many repositories, where most of them are clean most of the time.

## Usage

- Click the funnel icon at the top of Source Control. Only repositories with changes stay visible,
  and the list updates as you edit, commit or stash. Click it again to show all of them.
- The on/off state applies to every window and survives a reload.
- With the filter on, a new window applies it a few seconds after you first open Source Control.
- If something gets out of sync (for example, you hid a repository by hand under
  "View & Sort › Repositories"), run **SCM Changed Filter: Resync** from the Command Palette.
- Turning the filter on or off, and resyncing, write `scm.repositories.selectionMode` twice and
  restore the original value. That is the only way to make VS Code show every repository at once.
  The list may flicker briefly.

## Limitations

- Requires `scm.repositories.selectionMode` = `multiple` (the default).
- Local workspaces only. Does not work over WSL, SSH or Dev Containers.
- **Turn the filter off before uninstalling.** If you forget, unhide the repositories under
  `...` › View & Sort › Repositories.

## How it works

VS Code has no public API to hide a repository from Source Control. The extension:

1. Reads each repository's changes through the public API of the built-in Git extension.
2. Hides or shows a repository by running the same internal command used by
   "View & Sort › Repositories": `workbench.scm.action.toggleRepositoryVisibility.scm<N>`.
3. Finds out which `scm<N>` belongs to which folder by passing `{ $mid: 5, handle: N }` through
   `runCommands` to a probe command, which receives the real `SourceControl`.

Nothing in the VS Code installation is modified, and no Git command is run.

## If it stops working

Those internal details may change in any monthly VS Code release. If that happens, the filter turns
itself off and shows "SCM Changed Filter is not available in this version of VS Code." Logs are
under Output › SCM Changed Filter. Please open an issue with the VS Code version.

## Development

```sh
npm install
npm test          # compile and run the unit tests
npm run package   # build the .vsix
code --install-extension vscode-scm-changed-filter-0.1.0.vsix
```

To debug, open the folder in VS Code and press F5.

## License

[MIT](LICENSE)
