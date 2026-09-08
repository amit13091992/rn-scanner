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

describe('buildDependencyGraph (yarn - best effort)', () => {
  test('marks hierarchyComplete: false for a yarn-only project', async () => {
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
    strictEqual(graph!.hierarchyComplete, false);

    const paths = findPathsToPackage(graph!, 'chalk');
    strictEqual(paths.length, 1);
    strictEqual(paths[0].join(' > '), 'chalk');

    const chalkNode = graph!.nodes.get('node_modules/chalk');
    ok(chalkNode);
    strictEqual(chalkNode!.version, '5.3.0');
  });
});
