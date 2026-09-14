import { test, describe } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { writeFileSync, mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildDependencyGraph,
  findPathsToPackage,
  findDuplicateVersionPaths,
} from '../src/utils/dependencyGraph.js';

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
