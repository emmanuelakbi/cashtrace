// Gemini Integration - Prompt Manager
// Manages system prompts with versioning for A/B testing and rollback

export type PromptType =
  | 'receipt_extraction'
  | 'bank_statement_extraction'
  | 'pos_export_extraction'
  | 'insight_generation';

export interface SystemPrompt {
  type: PromptType;
  version: string;
  systemInstruction: string;
  exampleOutputs: string[];
  jsonSchema: object;
}

export interface PromptVersion {
  version: string;
  createdAt: Date;
  description: string;
  isActive: boolean;
}

interface StoredPrompt {
  prompt: SystemPrompt;
  createdAt: Date;
  description: string;
}

export class PromptManagerImpl {
  private readonly prompts: Map<PromptType, Map<string, StoredPrompt>> = new Map();
  private readonly activeVersions: Map<PromptType, string> = new Map();

  /**
   * Register a prompt with version metadata.
   * The first registered prompt for a type becomes the active version.
   */
  registerPrompt(prompt: SystemPrompt, description: string): void {
    const typeMap = this.prompts.get(prompt.type) ?? new Map<string, StoredPrompt>();

    if (typeMap.has(prompt.version)) {
      throw new Error(
        `Prompt version '${prompt.version}' already exists for type '${prompt.type}'`,
      );
    }

    typeMap.set(prompt.version, {
      prompt,
      createdAt: new Date(),
      description,
    });

    this.prompts.set(prompt.type, typeMap);

    // First registered version becomes active by default
    if (!this.activeVersions.has(prompt.type)) {
      this.activeVersions.set(prompt.type, prompt.version);
    }
  }

  /**
   * Get a prompt by type and optional version.
   * If no version is specified, returns the active version.
   */
  getPrompt(type: PromptType, version?: string): SystemPrompt {
    const typeMap = this.prompts.get(type);

    if (!typeMap || typeMap.size === 0) {
      throw new Error(`No prompts registered for type '${type}'`);
    }

    const resolvedVersion = version ?? this.getActiveVersion(type);
    const stored = typeMap.get(resolvedVersion);

    if (!stored) {
      throw new Error(`Prompt version '${resolvedVersion}' not found for type '${type}'`);
    }

    return stored.prompt;
  }

  /**
   * Get the active version string for a prompt type.
   */
  getActiveVersion(type: PromptType): string {
    const active = this.activeVersions.get(type);

    if (!active) {
      throw new Error(`No active version set for type '${type}'`);
    }

    return active;
  }

  /**
   * List all versions for a prompt type, sorted by creation date (newest first).
   */
  listVersions(type: PromptType): PromptVersion[] {
    const typeMap = this.prompts.get(type);

    if (!typeMap || typeMap.size === 0) {
      return [];
    }

    const activeVersion = this.activeVersions.get(type);

    return [...typeMap.entries()]
      .map(([version, stored]) => ({
        version,
        createdAt: stored.createdAt,
        description: stored.description,
        isActive: version === activeVersion,
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Set the active version for a prompt type.
   * The version must already be registered.
   */
  setActiveVersion(type: PromptType, version: string): void {
    const typeMap = this.prompts.get(type);

    if (!typeMap || !typeMap.has(version)) {
      throw new Error(`Prompt version '${version}' not found for type '${type}'`);
    }

    this.activeVersions.set(type, version);
  }
}
