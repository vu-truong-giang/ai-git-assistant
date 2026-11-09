import * as vscode from 'vscode';
import { CodeReviewResult, ReviewIssue, ReviewSeverity } from '../ai/parsers/reviewParser';
import { escapeHtml, renderMarkdown } from './markdown';

export interface PanelMeta {
    /** Small line under the title, e.g. "3 files · +20 −4 · gemini-flash-latest". */
    subtitle?: string;
    /** Warnings such as truncated files or redacted secrets. */
    notes?: string[];
}

interface PanelMessage {
    command?: string;
    file?: string;
    line?: string;
}

/**
 * One reusable editor tab that shows AI results (explanations, reviews, summaries).
 * All AI text is rendered through the escaping Markdown renderer.
 */
export class AIResultPanel {
    private panel?: vscode.WebviewPanel;
    private copyText = '';

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly openFileAt: (file: string, line?: number) => Promise<void>
    ) {}

    showLoading(title: string, message: string): void {
        this.render(title, `<div class="loading"><span class="spinner"></span><p>${escapeHtml(message)}</p></div>`, '');
    }

    showMarkdown(title: string, markdown: string, meta: PanelMeta = {}): void {
        this.render(title, `${header(title, meta)}<article class="markdown">${renderMarkdown(markdown)}</article>`, markdown);
    }

    showReview(title: string, review: CodeReviewResult, meta: PanelMeta = {}): void {
        this.render(title, `${header(title, meta)}${reviewHtml(review)}`, reviewToMarkdown(review));
    }

    showError(title: string, message: string): void {
        this.render(title, `<h1>${escapeHtml(title)}</h1><div class="error-box">${escapeHtml(message)}</div>`, message);
    }

    /** Closes the panel only if it is still showing a loading state for a cancelled task. */
    disposeIfLoading(): void {
        if (this.panel && this.copyText === '') {
            this.panel.dispose();
        }
    }

    private render(title: string, bodyHtml: string, copyText: string): void {
        this.copyText = copyText;
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'aiGitAssistant.result',
                title,
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                {
                    enableScripts: true,
                    retainContextWhenHidden: false,
                    localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'webview')]
                }
            );
            this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'ai-git-assistant.svg');
            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });
            this.panel.webview.onDidReceiveMessage((message: PanelMessage) => {
                void this.onMessage(message);
            });
        } else {
            this.panel.reveal(undefined, true);
        }
        this.panel.title = title;
        this.panel.webview.html = this.page(this.panel.webview, bodyHtml);
    }

    private async onMessage(message: PanelMessage): Promise<void> {
        if (message.command === 'copy') {
            await vscode.env.clipboard.writeText(this.copyText);
            void vscode.window.showInformationMessage('Đã copy kết quả vào clipboard.');
        } else if (message.command === 'openFile' && message.file) {
            const line = message.line ? Number(message.line) : undefined;
            await this.openFileAt(message.file, Number.isInteger(line) ? line : undefined);
        }
    }

    private page(webview: vscode.Webview, bodyHtml: string): string {
        const dir = vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'webview');
        const css = webview.asWebviewUri(vscode.Uri.joinPath(dir, 'aiPanel.css'));
        const js = webview.asWebviewUri(vscode.Uri.joinPath(dir, 'aiPanel.js'));
        const nonce = createNonce();
        return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource};">
<link rel="stylesheet" href="${css}">
<title>AI Result</title>
</head>
<body>
<div class="toolbar">${this.copyText ? '<button class="button" data-action="copy" type="button">⧉ Copy</button>' : ''}</div>
<main>${bodyHtml}</main>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
    }
}

function header(title: string, meta: PanelMeta): string {
    const notes = (meta.notes ?? []).filter(Boolean)
        .map(note => `<div class="note">${escapeHtml(note)}</div>`).join('');
    return `<h1>${escapeHtml(title)}</h1>${meta.subtitle ? `<p class="subtitle">${escapeHtml(meta.subtitle)}</p>` : ''}${notes}`;
}

const SEVERITY_LABEL: Record<ReviewSeverity, string> = {
    critical: 'Critical',
    major: 'Major',
    minor: 'Minor',
    info: 'Info'
};

function reviewHtml(review: CodeReviewResult): string {
    const counts = (['critical', 'major', 'minor', 'info'] as ReviewSeverity[])
        .map(severity => ({ severity, count: review.issues.filter(issue => issue.severity === severity).length }));
    const score = review.score !== null
        ? `<div class="score score-${review.score >= 8 ? 'good' : review.score >= 5 ? 'ok' : 'bad'}">${review.score}<small>/10</small></div>`
        : '';

    const issues = review.issues.length
        ? review.issues.map(issueHtml).join('')
        : '<div class="empty">✓ Không phát hiện vấn đề đáng kể.</div>';
    const improvements = review.improvements.length
        ? `<h2>Đề xuất cải thiện</h2><ul>${review.improvements.map(item => `<li>${renderMarkdown(item).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ul>`
        : '';

    return `<section class="review-summary">
        ${score}
        <div>
            <div class="markdown">${renderMarkdown(review.summary || '')}</div>
            <div class="counts">${counts.map(item => `<span class="sev sev-${item.severity}">${SEVERITY_LABEL[item.severity]}: ${item.count}</span>`).join('')}</div>
        </div>
    </section>
    <h2>Vấn đề phát hiện (${review.issues.length})</h2>
    ${issues}
    ${improvements}`;
}

function issueHtml(issue: ReviewIssue): string {
    const location = issue.file
        ? `<button class="file-link" data-action="openFile" data-file="${escapeHtml(issue.file)}" data-line="${issue.line ?? ''}">${escapeHtml(issue.file)}${issue.line ? `:${issue.line}` : ''}</button>`
        : '';
    return `<article class="issue issue-${issue.severity}">
        <div class="issue-head">
            <span class="sev sev-${issue.severity}">${SEVERITY_LABEL[issue.severity]}</span>
            <span class="tag">${escapeHtml(issue.category)}</span>
            <strong>${escapeHtml(issue.title)}</strong>
        </div>
        ${location}
        ${issue.description ? `<div class="markdown">${renderMarkdown(issue.description)}</div>` : ''}
        ${issue.suggestion ? `<div class="suggestion"><span>Đề xuất</span><div class="markdown">${renderMarkdown(issue.suggestion)}</div></div>` : ''}
    </article>`;
}

export function reviewToMarkdown(review: CodeReviewResult): string {
    const lines = [`# AI Code Review`, '', review.summary];
    if (review.score !== null) {
        lines.push('', `Score: ${review.score}/10`);
    }
    lines.push('', `## Issues (${review.issues.length})`);
    for (const issue of review.issues) {
        lines.push('', `### [${issue.severity}] ${issue.title}`,
            `${issue.category} · ${issue.file}${issue.line ? `:${issue.line}` : ''}`, '', issue.description);
        if (issue.suggestion) {
            lines.push('', `**Suggestion:** ${issue.suggestion}`);
        }
    }
    if (review.improvements.length) {
        lines.push('', '## Improvements', ...review.improvements.map(item => `- ${item}`));
    }
    return lines.join('\n');
}

function createNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';
    for (let index = 0; index < 32; index++) {
        value += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return value;
}
