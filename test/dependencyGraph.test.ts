import { test, describe } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { writeFileSync, mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  buildDependencyGraph,
  findPathsToPackage,
  findDuplicateVersionPaths,
} from '../src/utils/dependencyGraph.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeTempProject(): string {
  return mkdtempSync(join(tmpdir(), 'dep-graph-test-'));
}

describe('buildDependencyGraph (npm)', () => {
  test('builds a simple 2-level chain from package-lock.json v3', async () => {
    const dir = makeTempProject();

    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { foo: '^1.0.0' },
      })
    );

    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: {
          '': { name: 'app', version: '1.0.0', dependencies: { foo: '^1.0.0' } },
          'node_modules/foo': {
            version: '1.0.0',
            dependencies: { bar: '^2.0.0' },
          },
          'node_modules/foo/node_modules/bar': {
            version: '2.0.0',
          },
        },
      })
    );

    const graph = await buildDependencyGraph(dir);
    ok(graph, 'graph should be built');
    strictEqual(graph!.manager, 'npm');
    strictEqual(graph!.hierarchyComplete, true);
    strictEqual(graph!.root, '');

    const fooNode = graph!.nodes.get('node_modules/foo');
    ok(fooNode);
    strictEqual(fooNode!.name, 'foo');
    strictEqual(fooNode!.version, '1.0.0');
    strictEqual(fooNode!.parents.length, 1);
    strictEqual(fooNode!.parents[0], '');

    const barNode = graph!.nodes.get('node_modules/foo/node_modules/bar');
    ok(barNode);
    strictEqual(barNode!.name, 'bar');
    strictEqual(barNode!.parents[0], 'node_modules/foo');

    const pathsToBar = findPathsToPackage(graph!, 'bar');
    strictEqual(pathsToBar.length, 1);
    strictEqual(pathsToBar[0].join(' > '), 'foo > bar');

    const pathsToFoo = findPathsToPackage(graph!, 'foo');
    strictEqual(pathsToFoo.length, 1);
    strictEqual(pathsToFoo[0].join(' > '), 'foo');
  });

  test('detects duplicate versions of the same package at different nested paths', async () => {
    const dir = makeTempProject();

    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { foo: '^1.0.0', baz: '^1.0.0' },
      })
    );

    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: {
          '': {
            name: 'app',
            version: '1.0.0',
            dependencies: { foo: '^1.0.0', baz: '^1.0.0' },
          },
          'node_modules/foo': {
            version: '1.0.0',
            dependencies: { shared: '^2.0.0' },
          },
          'node_modules/foo/node_modules/shared': { version: '2.0.0' },
          'node_modules/baz': {
            version: '1.0.0',
            dependencies: { shared: '^1.0.0' },
          },
          'node_modules/baz/node_modules/shared': { version: '1.0.0' },
        },
      })
    );

    const graph = await buildDependencyGraph(dir);
    ok(graph);

    const duplicates = findDuplicateVersionPaths(graph!);
    ok(duplicates.has('shared'));

    const sharedVersions = duplicates.get('shared')!;
    strictEqual(sharedVersions.length, 2);

    const versionStrings = sharedVersions.map(v => v.version).sort();
    strictEqual(versionStrings.join(','), '1.0.0,2.0.0');

    const v1Entry = sharedVersions.find(v => v.version === '1.0.0');
    const v2Entry = sharedVersions.find(v => v.version === '2.0.0');
    ok(v1Entry);
    ok(v2Entry);
    strictEqual(v1Entry!.paths.length, 1);
    strictEqual(v1Entry!.paths[0].join(' > '), 'baz > shared');
    strictEqual(v2Entry!.paths.length, 1);
    strictEqual(v2Entry!.paths[0].join(' > '), 'foo > shared');
  });

  test('returns null when no package.json exists', async () => {
    const dir = makeTempProject();
    const graph = await buildDependencyGraph(dir);
    strictEqual(graph, null);
  });
});

describe('buildDependencyGraph (yarn - real hierarchy)', () => {
  test('resolves a direct dependency with no transitive deps', async () => {
    const dir = makeTempProject();

    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: {
          '@react-navigation/native': '^7.0.0',
          chalk: '^5.0.0',
        },
      })
    );

    const yarnLockContent = `"@react-navigation/native@^7.0.0":
  version "7.1.5"
  resolved "https://registry.yarnpkg.com/@react-navigation/native/-/native-7.1.5.tgz#abc123"

"chalk@^5.0.0":
  version "5.3.0"
  resolved "https://registry.yarnpkg.com/chalk/-/chalk-5.3.0.tgz#def456"
`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'yarn.lock'), yarnLockContent);

    const graph = await buildDependencyGraph(dir);
    ok(graph);
    strictEqual(graph!.manager, 'yarn');
    strictEqual(graph!.hierarchyComplete, true);

    const paths = findPathsToPackage(graph!, 'chalk');
    strictEqual(paths.length, 1);
    strictEqual(paths[0].join(' > '), 'chalk');

    const chalkNode = graph!.nodes.get('chalk@5.3.0');
    ok(chalkNode);
    strictEqual(chalkNode!.version, '5.3.0');
  });

  test('resolves a transitive dependency through a "dependencies:" block', async () => {
    const dir = makeTempProject();

    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { foo: '^1.0.0' },
      })
    );

    const yarnLockContent = `"foo@^1.0.0":
  version "1.2.3"
  resolved "https://registry.yarnpkg.com/foo/-/foo-1.2.3.tgz#abc"
  dependencies:
    bar "^2.0.0"

"bar@^2.0.0":
  version "2.5.0"
  resolved "https://registry.yarnpkg.com/bar/-/bar-2.5.0.tgz#def"
`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'yarn.lock'), yarnLockContent);

    const graph = await buildDependencyGraph(dir);
    ok(graph);
    strictEqual(graph!.hierarchyComplete, true);

    const paths = findPathsToPackage(graph!, 'bar');
    strictEqual(paths.length, 1);
    strictEqual(paths[0].join(' > '), 'foo > bar');

    const barNode = graph!.nodes.get('bar@2.5.0');
    ok(barNode);
    strictEqual(barNode!.version, '2.5.0');
  });
});

describe('buildDependencyGraph (pnpm - real hierarchy)', () => {
  test('resolves a transitive dependency through a package entry\'s dependencies block', async () => {
    const dir = makeTempProject();

    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { foo: '^1.0.0' },
      })
    );

    const pnpmLockContent = `lockfileVersion: 5.4

dependencies:
  foo: 1.2.3

packages:
  /foo@1.2.3:
    version: 1.2.3
    dependencies:
      bar: 2.5.0
    dev: false

  /bar@2.5.0:
    version: 2.5.0
    dev: false
`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pnpm-lock.yaml'), pnpmLockContent);

    const graph = await buildDependencyGraph(dir);
    ok(graph);
    strictEqual(graph!.manager, 'pnpm');
    strictEqual(graph!.hierarchyComplete, true);

    const paths = findPathsToPackage(graph!, 'bar');
    strictEqual(paths.length, 1);
    strictEqual(paths[0].join(' > '), 'foo > bar');
  });
});

describe('buildDependencyGraph (bun - real hierarchy)', () => {
  test('resolves a transitive dependency through a package entry\'s dependencies field', async () => {
    const dir = makeTempProject();

    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { foo: '^1.0.0' },
      })
    );

    const bunLockContent = JSON.stringify({
      lockfileVersion: 0,
      workspaces: {
        '': { name: 'app', dependencies: { foo: '^1.0.0' } },
      },
      packages: {
        foo: ['foo@1.2.3', '', { dependencies: { bar: '^2.0.0' } }, 'sha512-abc'],
        bar: ['bar@2.5.0', '', {}, 'sha512-def'],
      },
    });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bun.lock'), bunLockContent);

    const graph = await buildDependencyGraph(dir);
    ok(graph);
    strictEqual(graph!.manager, 'bun');
    strictEqual(graph!.hierarchyComplete, true);

    const paths = findPathsToPackage(graph!, 'bar');
    strictEqual(paths.length, 1);
    strictEqual(paths[0].join(' > '), 'foo > bar');
  });

  test('resolves scoped packages as both direct deps and transitive children', async () => {
    const dir = makeTempProject();

    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { '@react-navigation/native': '^7.0.0' },
      })
    );

    const bunLockContent = JSON.stringify({
      lockfileVersion: 0,
      workspaces: {
        '': { name: 'app', dependencies: { '@react-navigation/native': '^7.0.0' } },
      },
      packages: {
        '@react-navigation/native': [
          '@react-navigation/native@7.1.5',
          '',
          { dependencies: { '@react-navigation/core': '^7.0.0' } },
          'sha512-abc',
        ],
        '@react-navigation/core': ['@react-navigation/core@7.2.0', '', {}, 'sha512-def'],
      },
    });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bun.lock'), bunLockContent);

    const graph = await buildDependencyGraph(dir);
    ok(graph);
    strictEqual(graph!.manager, 'bun');
    strictEqual(graph!.hierarchyComplete, true);

    const paths = findPathsToPackage(graph!, '@react-navigation/core');
    strictEqual(paths.length, 1);
    strictEqual(paths[0].join(' > '), '@react-navigation/native > @react-navigation/core');
  });

  test('only wires direct edges for dependencies declared in the workspace root', async () => {
    const dir = makeTempProject();

    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { foo: '^1.0.0' },
      })
    );

    const bunLockContent = JSON.stringify({
      lockfileVersion: 0,
      workspaces: {
        '': { name: 'app', dependencies: { foo: '^1.0.0' } },
      },
      packages: {
        foo: ['foo@1.2.3', '', {}, 'sha512-abc'],
        // Present in the lockfile (e.g. a stale/leftover entry) but not declared at the root —
        // should not be wired as a direct root child.
        stray: ['stray@9.9.9', '', {}, 'sha512-def'],
      },
    });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bun.lock'), bunLockContent);

    const graph = await buildDependencyGraph(dir);
    ok(graph);
    strictEqual(graph!.manager, 'bun');

    const rootNode = graph!.nodes.get('')!;
    strictEqual(rootNode.children.includes('foo'), true);
    strictEqual(rootNode.children.includes('stray'), false);
  });
});

describe('buildDependencyGraph (yarn workspace)', () => {
  test('finds the workspace root yarn.lock when run from a package with no lockfile of its own', async () => {
    const dir = join(__dirname, '..', 'test-fixtures', 'monorepo-yarn', 'packages', 'mobile-app');

    const graph = await buildDependencyGraph(dir);
    ok(graph);
    strictEqual(graph!.manager, 'yarn');
    strictEqual(graph!.hierarchyComplete, true);

    const paths = findPathsToPackage(graph!, 'left-pad');
    ok(paths.length > 0);
  });
});

describe('buildDependencyGraph (workspace package cross-linking)', () => {
  test('yarn: a workspace package depending on a sibling workspace package resolves it as a local node, not via the lockfile', async () => {
    const root = makeTempProject();
    const sharedDir = join(root, 'packages', 'shared');
    const appDir = join(root, 'packages', 'mobile-app');
    mkdirSync(sharedDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'monorepo-root', private: true, workspaces: ['packages/*'] })
    );
    writeFileSync(
      join(sharedDir, 'package.json'),
      JSON.stringify({ name: '@acme/shared', version: '1.0.0', dependencies: { 'left-pad': '^1.0.0' } })
    );
    writeFileSync(
      join(appDir, 'package.json'),
      JSON.stringify({ name: 'mobile-app', dependencies: { '@acme/shared': 'workspace:^1.0.0' } })
    );
    writeFileSync(
      join(root, 'yarn.lock'),
      `left-pad@^1.0.0:\n  version "1.3.0"\n  resolved "https://registry.yarnpkg.com/left-pad/-/left-pad-1.3.0.tgz"\n`
    );

    const graph = await buildDependencyGraph(appDir);
    ok(graph);
    strictEqual(graph!.manager, 'yarn');
    strictEqual(graph!.hierarchyComplete, true);

    const sharedNode = graph!.nodes.get('workspace:@acme/shared');
    ok(sharedNode, 'expected the sibling workspace package to be linked as a node');
    strictEqual(sharedNode!.workspace, true);

    const paths = findPathsToPackage(graph!, 'left-pad');
    strictEqual(paths.length, 1);
    strictEqual(paths[0].join(' > '), '@acme/shared > left-pad');
  });

  test('pnpm: a workspace package depending on a sibling workspace package resolves it as a local node', async () => {
    const root = makeTempProject();
    const sharedDir = join(root, 'packages', 'shared');
    const appDir = join(root, 'packages', 'mobile-app');
    mkdirSync(sharedDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'monorepo-root', private: true })
    );
    writeFileSync(join(root, 'pnpm-workspace.yaml'), `packages:\n  - 'packages/*'\n`);
    writeFileSync(
      join(sharedDir, 'package.json'),
      JSON.stringify({ name: '@acme/shared', version: '1.0.0', dependencies: { 'left-pad': '^1.0.0' } })
    );
    writeFileSync(
      join(appDir, 'package.json'),
      JSON.stringify({ name: 'mobile-app', dependencies: { '@acme/shared': 'workspace:^1.0.0' } })
    );
    writeFileSync(
      join(root, 'pnpm-lock.yaml'),
      `lockfileVersion: 5.4\n\npackages:\n  /left-pad@1.3.0:\n    version: 1.3.0\n    dev: false\n`
    );

    const graph = await buildDependencyGraph(appDir);
    ok(graph);
    strictEqual(graph!.manager, 'pnpm');
    strictEqual(graph!.hierarchyComplete, true);

    const sharedNode = graph!.nodes.get('workspace:@acme/shared');
    ok(sharedNode, 'expected the sibling workspace package to be linked as a node');

    const paths = findPathsToPackage(graph!, 'left-pad');
    strictEqual(paths.length, 1);
    strictEqual(paths[0].join(' > '), '@acme/shared > left-pad');
  });

  test('bun: a workspace package depending on a sibling workspace package resolves it as a local node', async () => {
    const root = makeTempProject();
    const sharedDir = join(root, 'packages', 'shared');
    const appDir = join(root, 'packages', 'mobile-app');
    mkdirSync(sharedDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'monorepo-root', private: true, workspaces: ['packages/*'] })
    );
    writeFileSync(
      join(sharedDir, 'package.json'),
      JSON.stringify({ name: '@acme/shared', version: '1.0.0', dependencies: { 'left-pad': '^1.0.0' } })
    );
    writeFileSync(
      join(appDir, 'package.json'),
      JSON.stringify({ name: 'mobile-app', dependencies: { '@acme/shared': 'workspace:^1.0.0' } })
    );
    const bunLockContent = JSON.stringify({
      lockfileVersion: 0,
      workspaces: {
        '': { name: 'monorepo-root' },
      },
      packages: {
        'left-pad': ['left-pad@1.3.0', '', {}, 'sha512-abc'],
      },
    });
    writeFileSync(join(root, 'bun.lock'), bunLockContent);

    const graph = await buildDependencyGraph(appDir);
    ok(graph);
    strictEqual(graph!.manager, 'bun');
    strictEqual(graph!.hierarchyComplete, true);

    const sharedNode = graph!.nodes.get('workspace:@acme/shared');
    ok(sharedNode, 'expected the sibling workspace package to be linked as a node');

    const paths = findPathsToPackage(graph!, 'left-pad');
    strictEqual(paths.length, 1);
    strictEqual(paths[0].join(' > '), '@acme/shared > left-pad');
  });
});

describe('buildDependencyGraph (npm — real hoisted-tree resolution, not path nesting)', () => {
  test('a hoisted transitive dependency (flat at top-level node_modules, no path nesting) resolves as a child of its real parent, not of root', async () => {
    const dir = makeTempProject();

    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { foo: '^1.0.0' } })
    );

    // Realistic npm v3 shape: foo and bar are both flat at top-level node_modules (the common
    // hoisted case) — bar is NOT nested under foo/node_modules. The only signal that bar is a
    // dependency of foo, not of the root, is foo's own `dependencies` field.
    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'app', version: '1.0.0', dependencies: { foo: '^1.0.0' } },
          'node_modules/foo': { version: '1.0.0', dependencies: { bar: '^2.0.0' } },
          'node_modules/bar': { version: '2.0.0' },
        },
      })
    );

    const graph = await buildDependencyGraph(dir);
    ok(graph);
    strictEqual(graph!.manager, 'npm');

    const paths = findPathsToPackage(graph!, 'bar');
    strictEqual(paths.length, 1);
    strictEqual(paths[0].join(' > '), 'foo > bar');

    const rootNode = graph!.nodes.get(graph!.root)!;
    strictEqual(rootNode.children.includes('node_modules/bar'), false, 'bar must not be a direct child of root');
  });

  test('scopes the graph to the specific workspace package at cwd, not the whole monorepo lockfile', async () => {
    const root = makeTempProject();

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'monorepo-root', private: true, workspaces: ['packages/*'] })
    );
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'monorepo-root', workspaces: ['packages/*'] },
          'node_modules/@acme/shared': { resolved: 'packages/shared', link: true },
          'node_modules/mobile-app': { resolved: 'packages/mobile-app', link: true },
          'node_modules/left-pad': { version: '1.3.0' },
          'node_modules/right-pad': { version: '1.0.0' },
          'packages/shared': { name: '@acme/shared', version: '1.0.0', dependencies: { 'left-pad': '^1.0.0' } },
          'packages/mobile-app': { version: '1.0.0', dependencies: { 'right-pad': '^1.0.0' } },
        },
      })
    );

    const sharedDir = join(root, 'packages', 'shared');
    const appDir = join(root, 'packages', 'mobile-app');
    mkdirSync(sharedDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(sharedDir, 'package.json'), JSON.stringify({ name: '@acme/shared', version: '1.0.0', dependencies: { 'left-pad': '^1.0.0' } }));
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'mobile-app', version: '1.0.0', dependencies: { 'right-pad': '^1.0.0' } }));

    const graphFromApp = await buildDependencyGraph(appDir);
    ok(graphFromApp);
    strictEqual(graphFromApp!.root, 'packages/mobile-app');
    strictEqual(findPathsToPackage(graphFromApp!, 'right-pad').length, 1);
    strictEqual(findPathsToPackage(graphFromApp!, 'left-pad').length, 0, 'mobile-app cannot reach shared\'s dependency, it was never declared by mobile-app');

    const graphFromShared = await buildDependencyGraph(sharedDir);
    ok(graphFromShared);
    strictEqual(graphFromShared!.root, 'packages/shared');
    strictEqual(findPathsToPackage(graphFromShared!, 'left-pad').length, 1);
    strictEqual(findPathsToPackage(graphFromShared!, 'right-pad').length, 0);
  });

  test('a workspace package depending on a sibling workspace package follows the lockfile\'s link/resolved pointer', async () => {
    const root = makeTempProject();

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'monorepo-root', private: true, workspaces: ['packages/*'] })
    );
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'monorepo-root', workspaces: ['packages/*'] },
          'node_modules/@acme/shared': { resolved: 'packages/shared', link: true },
          'node_modules/left-pad': { version: '1.3.0' },
          'packages/shared': { name: '@acme/shared', version: '1.0.0', dependencies: { 'left-pad': '^1.0.0' } },
          'packages/mobile-app': { version: '1.0.0', dependencies: { '@acme/shared': '1.0.0' } },
        },
      })
    );

    const appDir = join(root, 'packages', 'mobile-app');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'mobile-app', version: '1.0.0', dependencies: { '@acme/shared': '1.0.0' } }));

    const graph = await buildDependencyGraph(appDir);
    ok(graph);
    const paths = findPathsToPackage(graph!, 'left-pad');
    strictEqual(paths.length, 1);
    strictEqual(paths[0].join(' > '), '@acme/shared > left-pad');
  });
});

describe('buildDependencyGraph (pnpm — modern lockfileVersion 9+ format)', () => {
  test('resolves a transitive dependency via the snapshots: block (not the legacy packages: block)', async () => {
    const dir = makeTempProject();

    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { 'is-odd': '^3.0.1' } })
    );

    // Real pnpm v9+ shape: `packages:` carries resolution metadata only (no `dependencies`);
    // the actual dependency graph lives in `snapshots:`, and direct deps live under
    // `importers:` rather than a top-level `dependencies:` block.
    writeFileSync(
      join(dir, 'pnpm-lock.yaml'),
      [
        "lockfileVersion: '9.0'",
        '',
        'importers:',
        '',
        '  .:',
        '    dependencies:',
        '      is-odd:',
        '        specifier: ^3.0.1',
        '        version: 3.0.1',
        '',
        'packages:',
        '',
        '  is-number@6.0.0:',
        "    resolution: {integrity: sha512-abc}",
        '',
        '  is-odd@3.0.1:',
        "    resolution: {integrity: sha512-def}",
        '',
        'snapshots:',
        '',
        '  is-number@6.0.0: {}',
        '',
        '  is-odd@3.0.1:',
        '    dependencies:',
        '      is-number: 6.0.0',
        '',
      ].join('\n')
    );

    const graph = await buildDependencyGraph(dir);
    ok(graph);
    strictEqual(graph!.manager, 'pnpm');
    strictEqual(graph!.hierarchyComplete, true);

    const paths = findPathsToPackage(graph!, 'is-number');
    strictEqual(paths.length, 1);
    strictEqual(paths[0].join(' > '), 'is-odd > is-number');
  });

  test('scopes to the specific workspace package via importers:, and cross-links a sibling workspace dependency', async () => {
    const root = makeTempProject();
    const sharedDir = join(root, 'packages', 'shared');
    const appDir = join(root, 'packages', 'mobile-app');
    mkdirSync(sharedDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });

    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root-app', private: true }));
    writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    writeFileSync(join(sharedDir, 'package.json'), JSON.stringify({ name: '@acme/shared', version: '1.0.0', dependencies: { 'is-odd': '^3.0.1' } }));
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'mobile-app', version: '1.0.0', dependencies: { '@acme/shared': 'workspace:^1.0.0' } }));

    writeFileSync(
      join(root, 'pnpm-lock.yaml'),
      [
        "lockfileVersion: '9.0'",
        '',
        'importers:',
        '',
        '  .: {}',
        '',
        '  packages/mobile-app:',
        '    dependencies:',
        "      '@acme/shared':",
        '        specifier: workspace:^1.0.0',
        '        version: link:../shared',
        '',
        '  packages/shared:',
        '    dependencies:',
        '      is-odd:',
        '        specifier: ^3.0.1',
        '        version: 3.0.1',
        '',
        'packages:',
        '',
        '  is-number@6.0.0:',
        "    resolution: {integrity: sha512-abc}",
        '',
        '  is-odd@3.0.1:',
        "    resolution: {integrity: sha512-def}",
        '',
        'snapshots:',
        '',
        '  is-number@6.0.0: {}',
        '',
        '  is-odd@3.0.1:',
        '    dependencies:',
        '      is-number: 6.0.0',
        '',
      ].join('\n')
    );

    const graph = await buildDependencyGraph(appDir);
    ok(graph);
    const paths = findPathsToPackage(graph!, 'is-number');
    strictEqual(paths.length, 1);
    strictEqual(paths[0].join(' > '), '@acme/shared > is-odd > is-number');
  });
});

describe('buildDependencyGraph (bun — workspace sub-package deps independent of the root\'s own)', () => {
  test('a workspace sub-package\'s own ordinary dependency resolves even when the root declares a different one', async () => {
    const root = makeTempProject();
    const appDir = join(root, 'packages', 'mobile-app');
    mkdirSync(appDir, { recursive: true });

    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root-app', private: true, workspaces: ['packages/*'], dependencies: { 'left-pad': '^1.0.0' } }));
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'mobile-app', version: '1.0.0', dependencies: { 'is-odd': '^3.0.1' } }));

    const bunLockContent = JSON.stringify({
      lockfileVersion: 2,
      workspaces: {
        '': { name: 'root-app', dependencies: { 'left-pad': '^1.0.0' } },
        'packages/mobile-app': { name: 'mobile-app', version: '1.0.0', dependencies: { 'is-odd': '^3.0.1' } },
      },
      packages: {
        'left-pad': ['left-pad@1.3.0', '', {}, 'sha512-abc'],
        'is-odd': ['is-odd@3.0.1', '', { dependencies: { 'is-number': '^6.0.0' } }, 'sha512-def'],
        'is-number': ['is-number@6.0.0', '', {}, 'sha512-ghi'],
      },
    });
    writeFileSync(join(root, 'bun.lock'), bunLockContent);

    const graph = await buildDependencyGraph(appDir);
    ok(graph);
    strictEqual(graph!.manager, 'bun');
    strictEqual(graph!.hierarchyComplete, true);

    const paths = findPathsToPackage(graph!, 'is-number');
    strictEqual(paths.length, 1);
    strictEqual(paths[0].join(' > '), 'is-odd > is-number');

    // left-pad is the root's own dependency, not mobile-app's — must not leak in.
    strictEqual(findPathsToPackage(graph!, 'left-pad').length, 0);
  });
});
