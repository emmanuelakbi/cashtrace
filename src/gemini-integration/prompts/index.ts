// Gemini Integration - Prompt management
// Barrel file for prompt manager and template exports

export { PromptManagerImpl } from './prompt-manager.js';
export type { PromptType, PromptVersion, SystemPrompt } from './prompt-manager.js';
export {
  BANK_STATEMENT_EXTRACTION_PROMPT,
  INSIGHT_GENERATION_PROMPT,
  POS_EXPORT_EXTRACTION_PROMPT,
  RECEIPT_EXTRACTION_PROMPT,
} from './templates/index.js';
