// Pinned workflow linters. CI downloads these exact release assets and checks
// their SHA-256 before running them (ci/install-workflow-linters.mjs).
// Dependabot doesn't track them. To update one, take the version and the
// asset digest from `gh api repos/<owner>/<repo>/releases/tags/<tag>`.
export const WORKFLOW_LINTERS = [
  {
    name: 'actionlint',
    version: '1.7.12',
    url: 'https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz',
    sha256: '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
  },
  {
    name: 'zizmor',
    version: '1.31.1',
    url: 'https://github.com/zizmorcore/zizmor/releases/download/v1.31.1/zizmor-x86_64-unknown-linux-gnu.tar.gz',
    sha256: 'd185f726bdaf92df78273217dfdd24ebcd6b0ef48cf3ce776ff5762b6e138c99',
  },
];

export const linter = (name) => WORKFLOW_LINTERS.find((l) => l.name === name);
