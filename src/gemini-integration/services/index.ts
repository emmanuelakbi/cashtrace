// Gemini Integration - Core services
// Barrel file for service exports

export { ExtractionServiceImpl } from './extraction-service.js';
export type {
  ExtractionOptions,
  ExtractionServiceConfig,
  ExtractionServiceDeps,
} from './extraction-service.js';

export { GeminiClient } from './gemini-client.js';
export type {
  GeminiClientOptions,
  GeminiContent,
  GeminiPart,
  GeminiResponse,
  GenerateOptions,
} from './gemini-client.js';

export { GeminiService } from './gemini-service.js';
export type { GeminiServiceInterface } from './gemini-service.js';

export { InsightServiceImpl } from './insight-service.js';
export type {
  InsightOptions,
  InsightServiceConfig,
  InsightServiceDeps,
} from './insight-service.js';
