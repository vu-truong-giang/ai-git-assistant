import { AIError } from '../models/AIError.model';

/**
 * Parses a JSON object from a model answer, tolerating code fences
 * and stray text around the object.
 */
export function extractJsonObject(text: string, providerId = 'ai'): Record<string, unknown> {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) {
        throw new AIError('INVALID_RESPONSE', 'The AI answer does not contain a JSON object.', providerId);
    }
    try {
        const value: unknown = JSON.parse(candidate.slice(start, end + 1));
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('not an object');
        }
        return value as Record<string, unknown>;
    } catch (error) {
        throw new AIError('INVALID_RESPONSE', 'The AI answer is not valid JSON.', providerId, undefined, error);
    }
}

export function asString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : value === undefined || value === null ? fallback : String(value);
}
