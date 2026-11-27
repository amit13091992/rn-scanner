// Compares npm's latest react-native / expo against the hand-maintained registries and exits 1
// (printing a markdown report) when either has shipped a version the registry has no entry for.
// Requires `npm run build` first — it reads the compiled registries from dist/.
import { getKnownReactNativeVersions } from '../dist/data/reactNative/index.js';
import { EXPO_SDK_REGISTRY } from '../dist/data/expo/registry.js';

async function latestTag(pkg) {
  const res = await fetch(`https://registry.npmjs.org/-/package/${pkg}/dist-tags`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${pkg}: HTTP ${res.status}`);
  const tags = await res.json();
  if (typeof tags.latest !== 'string') throw new Error(`${pkg}: no "latest" dist-tag`);
  return tags.latest;
}

const minor = (version) => Number(/^\d+\.(\d+)\./.exec(version)?.[1]);

const problems = [];

try {
  const rnLatest = await latestTag('react-native');
  const known = getKnownReactNativeVersions().map((v) => Number(v.split('.')[1]));
  const registryMax = Math.max(...known);
  if (!Number.isFinite(minor(rnLatest))) throw new Error(`unparseable react-native version "${rnLatest}"`);
  if (minor(rnLatest) > registryMax) {
    problems.push(
      `react-native \`latest\` is ${rnLatest} but \`src/data/reactNative/registry.ts\` stops at 0.${registryMax} — follow \`src/data/reactNative/MAINTENANCE.md\`.`
    );
  }
} catch (error) {
  console.error(`Could not check react-native: ${error.message}`);
  process.exit(2);
}

try {
  const expoLatest = await latestTag('expo');
  const expoMajor = Number(expoLatest.split('.')[0]);
  const registryMax = Math.max(...EXPO_SDK_REGISTRY.map((entry) => entry.sdk));
  if (!Number.isFinite(expoMajor)) throw new Error(`unparseable expo version "${expoLatest}"`);
  if (expoMajor > registryMax) {
    problems.push(
      `expo \`latest\` is ${expoLatest} (SDK ${expoMajor}) but \`src/data/expo/registry.ts\` stops at SDK ${registryMax}.`
    );
  }
} catch (error) {
  console.error(`Could not check expo: ${error.message}`);
  process.exit(2);
}

if (problems.length > 0) {
  console.log(problems.map((p) => `- ${p}`).join('\n'));
  process.exit(1);
}
console.log('Registries cover the latest react-native and expo releases.');
