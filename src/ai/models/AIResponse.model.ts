export type AIFinishReason = 'stop' | 'length' | 'safety' | 'other';

export interface AIUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}

export interface AIResponse {
    text: string;
    /** The model that actually produced the response. */
    model: string;
    finishReason: AIFinishReason;
    usage?: AIUsage;
}
