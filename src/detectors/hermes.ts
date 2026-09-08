import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coerce, gte } from 'semver';
import type { HermesInfo } from '../types/hermes.js';

function readFileSafe(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function detectFromGradleProperties(cwd: string): boolean | null {
  const content = readFileSafe(join(cwd, 'android', 'gradle.properties'));
  if (!content) return null;

  const match = content.match(/^\s*hermesEnabled\s*=\s*["']?(true|false)["']?/im);
  if (!match) return null;

  return match[1].toLowerCase() === 'true';
}

function detectFromBuildGradle(cwd: string): boolean | null {
  const content = readFileSafe(join(cwd, 'android', 'app', 'build.gradle'));
  if (!content) return null;

  const match = content.match(/enableHermes\s*:\s*(true|false)/i);
  if (!match) return null;

  return match[1].toLowerCase() === 'true';
}

function detectFromPodfile(cwd: string): boolean | null {
  const content = readFileSafe(join(cwd, 'ios', 'Podfile'));
  if (!content) return null;

  const match = content.match(/:hermes_enabled\s*=>\s*(true|false)|hermes_enabled\s*:\s*(true|false)/i);
  if (!match) return null;

  const value = (match[1] ?? match[2] ?? '').toLowerCase();
  if (!value) return null;

  return value === 'true';
}

function detectFromExpoConfig(cwd: string): boolean | null {
  for (const fileName of ['app.json', 'app.config.json']) {
    const content = readFileSafe(join(cwd, fileName));
    if (!content) continue;

    try {
      const parsed = JSON.parse(content);
      const jsEngine = parsed?.expo?.jsEngine;
      if (jsEngine === 'hermes') return true;
      if (jsEngine === 'jsc') return false;
    } catch {
      // ignore malformed JSON, best-effort detection
    }
  }

  return null;
}

export function detectHermes(cwd: string = process.cwd(), reactNativeVersion: string | null = null): HermesInfo {
  const gradlePropertiesResult = detectFromGradleProperties(cwd);
  if (gradlePropertiesResult !== null) {
    return {
      enabled: gradlePropertiesResult,
      detectedFrom: 'android-gradle-properties',
      reactNativeVersion,
    };
  }

  const buildGradleResult = detectFromBuildGradle(cwd);
  if (buildGradleResult !== null) {
    return {
      enabled: buildGradleResult,
      detectedFrom: 'android-build-gradle',
      reactNativeVersion,
    };
  }

  const podfileResult = detectFromPodfile(cwd);
  if (podfileResult !== null) {
    return {
      enabled: podfileResult,
      detectedFrom: 'ios-podfile',
      reactNativeVersion,
    };
  }

  const expoResult = detectFromExpoConfig(cwd);
  if (expoResult !== null) {
    return {
      enabled: expoResult,
      detectedFrom: 'expo-config',
      reactNativeVersion,
    };
  }

  const coerced = reactNativeVersion ? coerce(reactNativeVersion) : null;
  if (coerced && gte(coerced.version, '0.70.0')) {
    return {
      enabled: true,
      detectedFrom: 'default',
      reactNativeVersion,
    };
  }

  return {
    enabled: null,
    detectedFrom: 'unknown',
    reactNativeVersion,
  };
}
