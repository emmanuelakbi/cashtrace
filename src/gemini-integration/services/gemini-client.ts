// Gemini Integration - API Client Wrapper
// Thin wrapper around @google/generative-ai SDK with key rotation and error mapping

import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai';

import type { GeminiModel } from '../types/index.js';
import {
  GeminiServiceError,
  InvalidResponseError,
  QuotaExceededError,
  RateLimitError,
  TimeoutError,
} from '../types/index.js';

export interface GeminiClientOptions {
  apiKey: string;
  apiKeyBackup?: string;
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface GenerateOptions {
  model: GeminiModel;
  systemInstruction: string;
  temperature: number;
  maxOutputTokens: number;
  contents: GeminiContent[];
  jsonMode?: boolean;
}

export interface GeminiResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export class GeminiClient {
  private readonly primarySdk: GoogleGenerativeAI;
  private readonly backupSdk: GoogleGenerativeAI | null;

  constructor(options: GeminiClientOptions) {
    this.primarySdk = new GoogleGenerativeAI(options.apiKey);
    this.backupSdk = options.apiKeyBackup ? new GoogleGenerativeAI(options.apiKeyBackup) : null;
  }

  async generate(options: GenerateOptions): Promise<GeminiResponse> {
    try {
      return await this.executeGenerate(this.primarySdk, options);
    } catch (error: unknown) {
      if (this.backupSdk && this.isAuthError(error)) {
        return await this.executeGenerate(this.backupSdk, options);
      }
      throw this.mapError(error);
    }
  }

  private async executeGenerate(
    sdk: GoogleGenerativeAI,
    options: GenerateOptions,
  ): Promise<GeminiResponse> {
    const model = sdk.getGenerativeModel({
      model: options.model,
      systemInstruction: options.systemInstruction,
      generationConfig: {
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        ...(options.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    });

    const result = await model.generateContent({
      contents: options.contents,
    });

    const response = result.response;
    const text = response.text();
    const usage = response.usageMetadata;

    return {
      text,
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
    };
  }

  private isAuthError(error: unknown): boolean {
    if (error instanceof GoogleGenerativeAIFetchError) {
      return error.status === 401 || error.status === 403;
    }
    return false;
  }

  private mapError(error: unknown): Error {
    if (
      error instanceof RateLimitError ||
      error instanceof QuotaExceededError ||
      error instanceof InvalidResponseError ||
      error instanceof TimeoutError ||
      error instanceof GeminiServiceError
    ) {
      return error;
    }

    if (error instanceof GoogleGenerativeAIFetchError) {
      const status = error.status;
      const message = error.message;

      if (status === 429) {
        return new RateLimitError(message, 1000);
      }

      if (status === 403) {
        const errorMsg = String(error.errorDetails ?? '');
        if (errorMsg.toLowerCase().includes('quota')) {
          return new QuotaExceededError(message);
        }
        return new GeminiServiceError(message, 'AUTH_ERROR', false);
      }

      if (status === 401) {
        return new GeminiServiceError(message, 'AUTH_ERROR', false);
      }

      if (status === 500 || status === 503) {
        return new GeminiServiceError(message, 'SERVER_ERROR', true);
      }

      return new GeminiServiceError(message, 'API_ERROR', status !== undefined && status >= 500);
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        return new TimeoutError(error.message, 0);
      }
      return new GeminiServiceError(error.message, 'UNKNOWN_ERROR', false);
    }

    return new GeminiServiceError(String(error), 'UNKNOWN_ERROR', false);
  }
}
