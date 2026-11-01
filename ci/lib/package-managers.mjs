// The package managers Node's base image bundles, which the Dockerfile's
// runner stage removes: the server, its HEALTHCHECK, the owner CLI, and the
// store's CLI all run on `node` alone. The Dockerfile test reads the list, and
// the image smoke runs the snippet inside the built image.

/** What the runner stage deletes, as written in its RUN line. */
export const REMOVED_PATHS = [
  '/usr/local/lib/node_modules/npm',
  '/usr/local/lib/node_modules/corepack',
  '/usr/local/bin/npm',
  '/usr/local/bin/npx',
  '/usr/local/bin/corepack',
  '/usr/local/bin/yarn',
  '/usr/local/bin/yarnpkg',
  '/opt/yarn-v*',
];

/** Commands no directory on the image's PATH may hold. */
export const MANAGER_COMMANDS = ['npm', 'npx', 'corepack', 'pnpm', 'pnpx', 'yarn', 'yarnpkg'];

/**
 * Lists every package manager left under `root` ('/' in the image): a command
 * of that name in any PATH directory, even a dangling link, npm or corepack
 * under /usr/local/lib/node_modules, and a yarn release under /opt. Prints
 * JSON: { found }, sorted paths as seen from `root`.
 */
function managersFromInside(root, commands) {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const exists = (file) => {
    try {
      fs.lstatSync(path.join(root, file));
      return true;
    } catch {
      return false;
    }
  };
  const found = new Set();
  for (const dir of (process.env.PATH ?? '').split(':').filter(Boolean)) {
    for (const name of commands) {
      const file = path.posix.join(dir, name);
      if (exists(file)) found.add(file);
    }
  }
  for (const name of ['npm', 'corepack']) {
    const file = `/usr/local/lib/node_modules/${name}`;
    if (exists(file)) found.add(file);
  }
  let opt = [];
  try {
    opt = fs.readdirSync(path.join(root, 'opt'));
  } catch {
    // No /opt.
  }
  for (const entry of opt) if (entry.startsWith('yarn')) found.add(`/opt/${entry}`);
  process.stdout.write(JSON.stringify({ found: [...found].sort() }));
}

export const MANAGERS_SNIPPET = `(${managersFromInside.toString()})(process.argv[1], ${JSON.stringify(MANAGER_COMMANDS)})`;
