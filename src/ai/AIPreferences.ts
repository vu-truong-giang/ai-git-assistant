import { DEFAULT_EXCLUDE_PATTERNS } from './context/ContextLimiter';

/** User preferences that shape prompts and context (read from VS Code settings by the controller). */
export interface AIPreferences {
    /** Language for explanations, reviews, chat and summaries, e.g. "Vietnamese". */
    responseLanguage: string;
    /** Language of generated commit messages, e.g. "English". */
    commitLanguage: string;
    commitStyle: 'conventional' | 'simple';
    /** Character budget for diffs/content sent to the AI. */
    maxContextChars: number;
    excludePatterns: string[];
    redactSecrets: boolean;
}

export const DEFAULT_PREFERENCES: AIPreferences = {
    responseLanguage: 'Vietnamese',
    commitLanguage: 'English',
    commitStyle: 'conventional',
    maxContextChars: 60_000,
    excludePatterns: [...DEFAULT_EXCLUDE_PATTERNS],
    redactSecrets: true
};
