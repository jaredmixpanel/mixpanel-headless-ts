# Changesets

This folder is managed by [`@changesets/cli`](https://github.com/changesets/changesets)
(docs: https://changesets.dev). Every pull request that changes a published
package adds one changeset here (`npx changeset`), stating the bump level and
the release-note text; the release workflow folds them into the package
changelogs and versions. The three packages release in lockstep (one `fixed`
group in `config.json`); the two rig workspaces are never versioned or
published. Procedure: `CONTRIBUTING.md`, "Releasing".
