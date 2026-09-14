import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface GradleWrapperInfo {
  version?: string;
  source?: string;
}

/**
 * Detects the Gradle wrapper version from android/gradle/wrapper/gradle-wrapper.properties'
 * `distributionUrl` line, e.g.
 * distributionUrl=https\://services.gradle.org/distributions/gradle-8.10.2-all.zip
 */
export function detectGradleVersion(cwd: string): GradleWrapperInfo {
  const propsPath = join(cwd, 'android', 'gradle', 'wrapper', 'gradle-wrapper.properties');
  if (!existsSync(propsPath)) {
    return {};
  }

  let content: string;
  try {
    content = readFileSync(propsPath, 'utf-8');
  } catch {
    return {};
  }

  const match = /distributionUrl=.*gradle-([0-9]+(?:\.[0-9]+){1,2})-(?:bin|all)\.zip/.exec(content);
  if (!match) {
    return { source: propsPath };
  }

  return { version: match[1], source: propsPath };
}
