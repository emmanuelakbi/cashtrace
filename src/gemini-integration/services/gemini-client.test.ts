// Gemini Integration - GeminiClient unit tests

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GeminiServiceError,
  InvalidResponseError,
  QuotaExceededError,
  RateLimitError,
  TimeoutError,
} from '../types/index.js';

import type { GenerateOptions } from './gemini-client.js';
import { GeminiClient } from './gemini-client.js';

// --- Mock setup ---

const mockGenerateContent = vi.fn();
const mockText = vi.fn();
const mockGetGenerativeModel = vi.fn();

vi.mock('@google/generative-ai', () => {
  class MockGoogleGenerativeAI {
    apiKey: string;
    constructor(apiKey: string) {
      this.apiKey = apiKey;
    }
    getGenerativeModel = mockGetGenerativeModel;
  }

  class MockGoogleGenerativeAIFetchError extends Error {
    status: number | undefined;
    statusText: string | undefined;
    errorDetails: string | undefined;
    constructor(message: string, status?: number, statusText?: string, errorDetails?: string) {
      super(`[GoogleGenerativeAI Error]: ${message}`);
      this.status = status;
      this.statusText = statusText;
      this.errorDetails = errorDetails;
    }
  }

  return {
    GoogleGenerativeAI: MockGoogleGenerativeAI,
    GoogleGenerativeAIFetchError: MockGoogleGenerativeAIFetchError,
  };
});

// --- Helpers ---

function makeDefaultOptions(overrides?: Partial<GenerateOptions>): GenerateOptions {
  return {
    model: 'gemini-2.0-flash',
    systemInstruction: 'You are a helpful assistant.',
    temperature: 0.1,
    maxOutputTokens: 4096,
    contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
    ...overrides,
  };
}

function setupMockResponse(text: string, promptTokenCount = 10, candidatesTokenCount = 20): void {
  mockText.mockReturnValue(text);
  mockGenerateContent.mockResolvedValue({
    response: {
      text: mockText,
      usageMetadata: {
        promptTokenCount,
        candidatesTokenCount,
        totalTokenCount: promptTokenCount + candidatesTokenCount,
      },
    },
  });
  mockGetGenerativeModel.mockReturnValue({
    generateContent: mockGenerateContent,
  });
}

function setupMockError(error: Error): void {
  mockGenerateContent.mockRejectedValue(error);
  mockGetGenerativeModel.mockReturnValue({
    generateContent: mockGenerateContent,
  });
}

// Dynamically import the mock class for creating fetch errors
async function createFetchError(
  message: string,
  status?: number,
  statusText?: string,
  errorDetails?: string,
): Promise<Error> {
  const mod = await import('@google/generative-ai');
  const FetchError = (
    mod as unknown as {
      GoogleGenerativeAIFetchError: new (
        m: string,
        s?: number,
        st?: string,
        ed?: string,
      ) => Error & { status?: number; statusText?: string; errorDetails?: string };
    }
  ).GoogleGenerativeAIFetchError;
  return new FetchError(message, status, statusText, errorDetails);
}

// --- Tests ---

describe('GeminiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create client with primary key only', () => {
      const client = new GeminiClient({ apiKey: 'primary-key' });
      expect(client).toBeInstanceOf(GeminiClient);
    });

    it('should create client with primary and backup keys', () => {
      const client = new GeminiClient({
        apiKey: 'primary-key',
        apiKeyBackup: 'backup-key',
      });
      expect(client).toBeInstanceOf(GeminiClient);
    });
  });

  describe('generate', () => {
    it('should return text and token usage on success', async () => {
      setupMockResponse('Hello world', 15, 25);
      const client = new GeminiClient({ apiKey: 'test-key' });

      const result = await client.generate(makeDefaultOptions());

      expect(result).toEqual({
        text: 'Hello world',
        inputTokens: 15,
        outputTokens: 25,
      });
    });

    it('should pass model name to getGenerativeModel', async () => {
      setupMockResponse('ok');
      const client = new GeminiClient({ apiKey: 'test-key' });

      await client.generate(makeDefaultOptions({ model: 'gemini-2.0-pro' }));

      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-2.0-pro' }),
      );
    });

    it('should pass system instruction to getGenerativeModel', async () => {
      setupMockResponse('ok');
      const client = new GeminiClient({ apiKey: 'test-key' });

      await client.generate(makeDefaultOptions({ systemInstruction: 'Be concise.' }));

      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({ systemInstruction: 'Be concise.' }),
      );
    });

    it('should pass temperature and maxOutputTokens in generationConfig', async () => {
      setupMockResponse('ok');
      const client = new GeminiClient({ apiKey: 'test-key' });

      await client.generate(makeDefaultOptions({ temperature: 0.5, maxOutputTokens: 2048 }));

      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({
          generationConfig: expect.objectContaining({
            temperature: 0.5,
            maxOutputTokens: 2048,
          }),
        }),
      );
    });

    it('should set responseMimeType when jsonMode is true', async () => {
      setupMockResponse('{"key":"value"}');
      const client = new GeminiClient({ apiKey: 'test-key' });

      await client.generate(makeDefaultOptions({ jsonMode: true }));

      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({
          generationConfig: expect.objectContaining({
            responseMimeType: 'application/json',
          }),
        }),
      );
    });

    it('should not set responseMimeType when jsonMode is false', async () => {
      setupMockResponse('plain text');
      const client = new GeminiClient({ apiKey: 'test-key' });

      await client.generate(makeDefaultOptions({ jsonMode: false }));

      const config = mockGetGenerativeModel.mock.calls[0]?.[0]?.generationConfig;
      expect(config).not.toHaveProperty('responseMimeType');
    });

    it('should not set responseMimeType when jsonMode is undefined', async () => {
      setupMockResponse('plain text');
      const client = new GeminiClient({ apiKey: 'test-key' });

      await client.generate(makeDefaultOptions());

      const config = mockGetGenerativeModel.mock.calls[0]?.[0]?.generationConfig;
      expect(config).not.toHaveProperty('responseMimeType');
    });

    it('should pass contents to generateContent', async () => {
      setupMockResponse('ok');
      const client = new GeminiClient({ apiKey: 'test-key' });
      const contents = [{ role: 'user' as const, parts: [{ text: 'Parse this receipt' }] }];

      await client.generate(makeDefaultOptions({ contents }));

      expect(mockGenerateContent).toHaveBeenCalledWith({ contents });
    });

    it('should handle missing usageMetadata gracefully', async () => {
      mockText.mockReturnValue('response');
      mockGenerateContent.mockResolvedValue({
        response: {
          text: mockText,
          usageMetadata: undefined,
        },
      });
      mockGetGenerativeModel.mockReturnValue({
        generateContent: mockGenerateContent,
      });

      const client = new GeminiClient({ apiKey: 'test-key' });
      const result = await client.generate(makeDefaultOptions());

      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
    });

    it('should support inline data parts for images', async () => {
      setupMockResponse('{"transactions":[]}');
      const client = new GeminiClient({ apiKey: 'test-key' });
      const contents = [
        {
          role: 'user' as const,
          parts: [
            { text: 'Parse this receipt' },
            { inlineData: { mimeType: 'image/jpeg', data: 'base64data' } },
          ],
        },
      ];

      await client.generate(makeDefaultOptions({ contents }));

      expect(mockGenerateContent).toHaveBeenCalledWith({ contents });
    });
  });

  describe('API key rotation', () => {
    it('should fall back to backup key on 401 auth error', async () => {
      const authError = await createFetchError('Unauthorized', 401);
      let callCount = 0;
      mockGetGenerativeModel.mockImplementation(() => ({
        generateContent: (): Promise<unknown> => {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(authError);
          }
          return Promise.resolve({
            response: {
              text: () => 'backup response',
              usageMetadata: {
                promptTokenCount: 5,
                candidatesTokenCount: 10,
                totalTokenCount: 15,
              },
            },
          });
        },
      }));

      const client = new GeminiClient({
        apiKey: 'primary-key',
        apiKeyBackup: 'backup-key',
      });

      const result = await client.generate(makeDefaultOptions());

      expect(result.text).toBe('backup response');
      expect(callCount).toBe(2);
    });

    it('should fall back to backup key on 403 auth error', async () => {
      const authError = await createFetchError('Forbidden', 403);
      let callCount = 0;
      mockGetGenerativeModel.mockImplementation(() => ({
        generateContent: (): Promise<unknown> => {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(authError);
          }
          return Promise.resolve({
            response: {
              text: () => 'backup ok',
              usageMetadata: {
                promptTokenCount: 5,
                candidatesTokenCount: 10,
                totalTokenCount: 15,
              },
            },
          });
        },
      }));

      const client = new GeminiClient({
        apiKey: 'primary-key',
        apiKeyBackup: 'backup-key',
      });

      const result = await client.generate(makeDefaultOptions());
      expect(result.text).toBe('backup ok');
    });

    it('should not fall back when no backup key is configured', async () => {
      const authError = await createFetchError('Unauthorized', 401);
      setupMockError(authError);

      const client = new GeminiClient({ apiKey: 'primary-key' });

      await expect(client.generate(makeDefaultOptions())).rejects.toThrow(GeminiServiceError);
    });

    it('should not fall back on non-auth errors', async () => {
      const serverError = await createFetchError('Server Error', 500);
      setupMockError(serverError);

      const client = new GeminiClient({
        apiKey: 'primary-key',
        apiKeyBackup: 'backup-key',
      });

      await expect(client.generate(makeDefaultOptions())).rejects.toThrow(GeminiServiceError);
    });
  });

  describe('error mapping', () => {
    it('should map HTTP 429 to RateLimitError', async () => {
      const error = await createFetchError('Rate limited', 429);
      setupMockError(error);
      const client = new GeminiClient({ apiKey: 'test-key' });

      await expect(client.generate(makeDefaultOptions())).rejects.toThrow(RateLimitError);
    });

    it('should map HTTP 403 with quota message to QuotaExceededError', async () => {
      const error = await createFetchError(
        'Quota exceeded',
        403,
        'Forbidden',
        'quota exceeded for this project',
      );
      setupMockError(error);
      const client = new GeminiClient({ apiKey: 'test-key' });

      await expect(client.generate(makeDefaultOptions())).rejects.toThrow(QuotaExceededError);
    });

    it('should map HTTP 401 to GeminiServiceError with AUTH_ERROR code', async () => {
      const error = await createFetchError('Unauthorized', 401);
      setupMockError(error);
      const client = new GeminiClient({ apiKey: 'test-key' });

      try {
        await client.generate(makeDefaultOptions());
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GeminiServiceError);
        expect((e as GeminiServiceError).code).toBe('AUTH_ERROR');
        expect((e as GeminiServiceError).retryable).toBe(false);
      }
    });

    it('should map HTTP 500 to retryable GeminiServiceError', async () => {
      const error = await createFetchError('Internal Server Error', 500);
      setupMockError(error);
      const client = new GeminiClient({ apiKey: 'test-key' });

      try {
        await client.generate(makeDefaultOptions());
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GeminiServiceError);
        expect((e as GeminiServiceError).retryable).toBe(true);
      }
    });

    it('should map HTTP 503 to retryable GeminiServiceError', async () => {
      const error = await createFetchError('Service Unavailable', 503);
      setupMockError(error);
      const client = new GeminiClient({ apiKey: 'test-key' });

      try {
        await client.generate(makeDefaultOptions());
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GeminiServiceError);
        expect((e as GeminiServiceError).retryable).toBe(true);
      }
    });

    it('should map timeout/abort errors to TimeoutError', async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'AbortError';
      setupMockError(error);
      const client = new GeminiClient({ apiKey: 'test-key' });

      await expect(client.generate(makeDefaultOptions())).rejects.toThrow(TimeoutError);
    });

    it('should map unknown errors to GeminiServiceError', async () => {
      const error = new Error('Something unexpected');
      setupMockError(error);
      const client = new GeminiClient({ apiKey: 'test-key' });

      await expect(client.generate(makeDefaultOptions())).rejects.toThrow(GeminiServiceError);
    });

    it('should pass through already-mapped error types', async () => {
      const error = new InvalidResponseError('bad json', '{}');
      setupMockError(error);
      const client = new GeminiClient({ apiKey: 'test-key' });

      await expect(client.generate(makeDefaultOptions())).rejects.toThrow(InvalidResponseError);
    });
  });
});
