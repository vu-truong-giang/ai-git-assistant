import { REVIEW_CATEGORIES, REVIEW_SEVERITIES } from '../prompts/codeReviewPrompt';
import { asString, extractJsonObject } from './jsonResponse';

export type ReviewSeverity = typeof REVIEW_SEVERITIES[number];
export type ReviewCategory = typeof REVIEW_CATEGORIES[number];

export interface ReviewIssue {
    severity: ReviewSeverity;
    category: ReviewCategory;
    file: string;
    line: number | null;
    title: string;
    description: string;
    suggestion: string;
}

export interface CodeReviewResult {
    summary: string;
    score: number | null;
    issues: ReviewIssue[];
    improvements: string[];
}

const SEVERITY_ORDER: Record<ReviewSeverity, number> = { critical: 0, major: 1, minor: 2, info: 3 };

/** Validates and normalises the review JSON; unknown values fall back to safe defaults. */
export function parseReview(raw: string): CodeReviewResult {
    const json = extractJsonObject(raw);
    const issues = Array.isArray(json.issues) ? json.issues : [];

    const normalized: ReviewIssue[] = issues
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map(item => {
            const severity = asString(item.severity).toLowerCase() as ReviewSeverity;
            const category = asString(item.category).toLowerCase().replace(/[\s_]+/g, '-') as ReviewCategory;
            const line = Number(item.line);
            return {
                severity: REVIEW_SEVERITIES.includes(severity) ? severity : 'minor',
                category: REVIEW_CATEGORIES.includes(category) ? category : 'maintainability',
                file: asString(item.file).replace(/^[ab]\//, ''),
                line: Number.isInteger(line) && line > 0 ? line : null,
                title: asString(item.title, 'Issue').trim() || 'Issue',
                description: asString(item.description).trim(),
                suggestion: asString(item.suggestion).trim()
            };
        })
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

    const score = Number(json.score);
    return {
        summary: asString(json.summary).trim(),
        score: Number.isFinite(score) ? Math.min(10, Math.max(1, Math.round(score))) : null,
        issues: normalized,
        improvements: Array.isArray(json.improvements)
            ? json.improvements.map(item => asString(item).trim()).filter(Boolean)
            : []
    };
}
