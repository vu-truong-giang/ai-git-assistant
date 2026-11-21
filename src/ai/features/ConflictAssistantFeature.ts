import { AIError } from '../models/AIError.model';
import { asString, extractJsonObject } from '../parsers/jsonResponse';
import { buildConflictPrompt } from '../prompts/conflictPrompt';
import { redactSecrets } from '../context/SecretRedactor';
import { AIFeatureDeps, FeatureUnavailableError } from './AIFeatureContext';
import { applyConflictResolutions, parseConflictFile } from './conflictParser';

export interface ConflictSuggestion {
    filePath: string;
    resolvedContent: string;
    summary: string;
    explanations: { index: number; explanation: string }[];
    conflictCount: number;
}

/** EPIC 13: proposes a merged version of a conflicted file (never writes it). */
export class ConflictAssistantFeature {
    constructor(private readonly deps: AIFeatureDeps) {}

    async suggest(filePath: string, content: string, signal?: AbortSignal): Promise<ConflictSuggestion> {
        const preferences = this.deps.getPreferences();
        const parsed = parseConflictFile(content);
        if (parsed.hunks.length === 0) {
            throw new FeatureUnavailableError('File không còn conflict marker nào.');
        }

        const size = parsed.hunks.reduce((sum, hunk) =>
            sum + hunk.ours.length + hunk.theirs.length + (hunk.base?.length ?? 0)
            + hunk.contextBefore.length + hunk.contextAfter.length, 0);
        if (size > preferences.maxContextChars) {
            throw new FeatureUnavailableError(
                `Conflict quá lớn để gửi cho AI (${size} ký tự, giới hạn ${preferences.maxContextChars}). Hãy giải quyết thủ công.`);
        }

        let redacted = 0;
        const hunks = parsed.hunks.map(hunk => {
            if (!preferences.redactSecrets) {
                return hunk;
            }
            const clean = (value: string) => {
                const result = redactSecrets(value);
                redacted += result.count;
                return result.text;
            };
            return {
                ...hunk,
                ours: clean(hunk.ours),
                theirs: clean(hunk.theirs),
                base: hunk.base === undefined ? undefined : clean(hunk.base),
                contextBefore: clean(hunk.contextBefore),
                contextAfter: clean(hunk.contextAfter)
            };
        });
        if (redacted > 0) {
            // A resolution built from masked text would write "[REDACTED]" into the file.
            throw new FeatureUnavailableError('Vùng conflict chứa giá trị giống secret/API key nên không gửi cho AI. Hãy giải quyết thủ công.');
        }

        const response = await this.deps.ai.generate(buildConflictPrompt({
            filePath,
            hunks,
            oursLabel: parsed.hunks[0].oursLabel || 'current branch',
            theirsLabel: parsed.hunks[0].theirsLabel || 'incoming branch',
            language: preferences.responseLanguage
        }), { temperature: 0.1, responseFormat: 'json', signal });

        const json = extractJsonObject(response.text, this.deps.ai.providerId);
        const items = Array.isArray(json.resolutions) ? json.resolutions : [];
        const resolutions = new Map<number, string>();
        const explanations: ConflictSuggestion['explanations'] = [];
        for (const item of items) {
            if (!item || typeof item !== 'object') {
                continue;
            }
            const record = item as Record<string, unknown>;
            const index = Number(record.index);
            if (Number.isInteger(index) && typeof record.content === 'string') {
                resolutions.set(index, record.content);
                explanations.push({ index, explanation: asString(record.explanation).trim() });
            }
        }

        let resolvedContent: string;
        try {
            resolvedContent = applyConflictResolutions(parsed, resolutions);
        } catch (error) {
            throw new AIError('INVALID_RESPONSE', error instanceof Error ? error.message : String(error), this.deps.ai.providerId, undefined, error);
        }

        return {
            filePath,
            resolvedContent,
            summary: asString(json.summary).trim(),
            explanations: explanations.sort((a, b) => a.index - b.index),
            conflictCount: parsed.hunks.length
        };
    }
}
