# Changesets

This folder holds [changesets](https://github.com/changesets/changesets): one
Markdown file per pending change describing the bump (patch/minor/major) and a
summary for the changelog.

Add one with `npx changeset`, commit it with your PR. On merge to `main`, the
release workflow opens a "Version Packages" PR; merging that publishes to npm.
