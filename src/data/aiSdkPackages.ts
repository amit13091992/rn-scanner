export interface AiSdkEntry {
  packageName: string;
  provider: string;
}

/**
 * Packages that let app code call an AI provider's API directly. Flagging these is about the
 * calling pattern, not the package itself — a backend proxying the same SDK is fine, a mobile
 * client doing it directly ships the provider key in the app bundle. Curated, same staleness
 * risk as `data/deprecatedPackages.ts`/`data/legacyApis.ts`.
 */
export const AI_SDK_PACKAGES: AiSdkEntry[] = [
  { packageName: 'openai', provider: 'OpenAI' },
  { packageName: '@anthropic-ai/sdk', provider: 'Anthropic' },
  { packageName: '@google/generative-ai', provider: 'Google' },
  { packageName: '@google/genai', provider: 'Google' },
  { packageName: '@ai-sdk/openai', provider: 'OpenAI' },
  { packageName: '@ai-sdk/anthropic', provider: 'Anthropic' },
  { packageName: '@ai-sdk/google', provider: 'Google' },
  { packageName: 'ai', provider: 'Vercel AI SDK' },
  { packageName: 'react-native-openai', provider: 'OpenAI' },
  { packageName: 'cohere-ai', provider: 'Cohere' },
  { packageName: 'groq-sdk', provider: 'Groq' },
  { packageName: '@mistralai/mistralai', provider: 'Mistral' },
];
