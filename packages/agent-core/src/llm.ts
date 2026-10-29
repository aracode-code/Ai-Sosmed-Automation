export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Minta provider mengembalikan JSON object (mis. DeepSeek `response_format`). */
  jsonMode?: boolean;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmResponse {
  content: string;
  model: string;
  usage?: LlmUsage;
  finishReason?: string;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}
