import * as path from 'path';
import * as vscode from 'vscode';
import { AIService, AIServiceSettings } from '../ai/AIService';
import { AIPreferences, DEFAULT_PREFERENCES } from '../ai/AIPreferences';
import { ApiKeyManager } from '../ai/ApiKeyManager';
import { DEFAULT_EXCLUDE_PATTERNS } from '../ai/context/ContextLimiter';
import { GitContextBuilder } from '../ai/context/GitContextBuilder';
import { GitContext, GitDiffScope } from '../ai/context/GitContext.model';
import { describeAIError } from '../ai/errorMessages';
import { AIFeatureDeps, FeatureUnavailableError } from '../ai/features/AIFeatureContext';
import { CodeReviewFeature } from '../ai/features/CodeReviewFeature';
import { CommitMessageFeature } from '../ai/features/CommitMessageFeature';
import { ConflictAssistantFeature } from '../ai/features/ConflictAssistantFeature';
import { ExplainDiffFeature } from '../ai/features/ExplainDiffFeature';
import { ChatTurn, GitChatSession } from '../ai/features/GitChatSession';
import { SummaryFeature } from '../ai/features/SummaryFeature';
import { AIError } from '../ai/models/AIError.model';
import { GeminiProvider } from '../ai/providers/GeminiProvider';
import { computeDiffStats } from '../ai/context/diffUtils';
import { IDiffService } from '../git/interfaces/DiffService.interface';
import { ICommitService } from '../git/interfaces/CommitService.interface';
import { IBranchService } from '../git/interfaces/IGitBranchService';
import { IStatusService } from '../git/interfaces/IGitStatusService';
import { IConflictService } from '../git/interfaces/ConflictService.interface';
import { AIResultPanel } from './AIResultPanel';
import { escapeHtml, renderMarkdown } from './markdown';

export type AITask =
    | 'commit' | 'explain' | 'review' | 'chat' | 'test'
    | 'historySummary' | 'branchSummary' | 'conflict' | 'models';

export interface AIViewState {
    status: {
        enabled: boolean;
        provider: string;
        model: string;
        hasApiKey: boolean;
    };
    busy: AITask[];
    chat: { role: 'user' | 'assistant'; html: string; text: string }[];
}

export interface AIControllerDeps {
    workspaceRoot: string;
    status: IStatusService;
    diff: IDiffService;
    branch: IBranchService;
    commit: ICommitService;
    conflict: IConflictService;
}

interface GitExtensionApi {
    repositories: { rootUri: vscode.Uri; inputBox: { value: string } }[];
}

const CONSENT_KEY = 'aiGitAssistant.ai.dataConsent.v1';
const CHAT_KEY = 'aiGitAssistant.ai.chatHistory';
const PROPOSAL_SCHEME = 'ai-git-proposal';
const SIDEBAR_VIEW_ID = 'aiGitAssistant.overview';

/**
 * VS Code glue for every AI feature: settings, API key, consent, progress/cancellation,
 * error notifications and result display. The features themselves live in src/ai.
 */
export class AIController implements vscode.Disposable {
    private readonly output = vscode.window.createOutputChannel('AI Git Assistant');
    private readonly stateEmitter = new vscode.EventEmitter<AIViewState>();
    readonly onDidChangeState = this.stateEmitter.event;

    private readonly ai: AIService;
    private readonly commitFeature: CommitMessageFeature;
    private readonly explainFeature: ExplainDiffFeature;
    private readonly reviewFeature: CodeReviewFeature;
    private readonly conflictFeature: ConflictAssistantFeature;
    private readonly summaryFeature: SummaryFeature;
    private readonly chatSession: GitChatSession;
    private readonly panel: AIResultPanel;

    private readonly running = new Map<AITask, AbortController>();
    private readonly proposals = new Map<string, string>();
    private readonly disposables: vscode.Disposable[] = [];
    private hasApiKey = false;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly apiKeys: ApiKeyManager,
        private readonly deps: AIControllerDeps
    ) {
        const provider = new GeminiProvider(() => this.apiKeys.getApiKey());
        this.ai = new AIService(provider, () => this.readServiceSettings(), {
            log: line => this.output.appendLine(`${new Date().toISOString()} ${line}`)
        });

        const featureDeps: AIFeatureDeps = {
            ai: this.ai,
            contextBuilder: new GitContextBuilder(deps.status, deps.diff, deps.branch, deps.commit, deps.workspaceRoot),
            commits: deps.commit,
            getPreferences: () => this.readPreferences()
        };
        this.commitFeature = new CommitMessageFeature(featureDeps);
        this.explainFeature = new ExplainDiffFeature(featureDeps);
        this.reviewFeature = new CodeReviewFeature(featureDeps);
        this.conflictFeature = new ConflictAssistantFeature(featureDeps);
        this.summaryFeature = new SummaryFeature(featureDeps);
        this.chatSession = new GitChatSession(
            featureDeps,
            context.workspaceState.get<ChatTurn[]>(CHAT_KEY, [])
        );
        this.panel = new AIResultPanel(context.extensionUri, (file, line) => this.openFileAt(file, line));

        this.disposables.push(
            this.output,
            this.stateEmitter,
            this.apiKeys.onDidChange(() => void this.refreshStatus()),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('aiGitAssistant.ai')) {
                    this.fireState();
                }
            }),
            vscode.workspace.registerTextDocumentContentProvider(PROPOSAL_SCHEME, {
                provideTextDocumentContent: uri => this.proposals.get(uri.query) ?? ''
            })
        );
        void this.refreshStatus();
    }

    dispose(): void {
        for (const controller of this.running.values()) {
            controller.abort();
        }
        this.disposables.forEach(disposable => disposable.dispose());
    }

    // ------------------------------------------------------------------
    // State for the sidebar
    // ------------------------------------------------------------------

    getState(): AIViewState {
        return {
            status: {
                enabled: this.ai.isEnabled(),
                provider: this.ai.providerName,
                model: this.ai.model,
                hasApiKey: this.hasApiKey
            },
            busy: [...this.running.keys()],
            chat: this.chatSession.history.map(turn => ({
                role: turn.role,
                text: turn.content,
                html: turn.role === 'assistant'
                    ? renderMarkdown(turn.content)
                    : escapeHtml(turn.content).replace(/\n/g, '<br>')
            }))
        };
    }

    private async refreshStatus(): Promise<void> {
        this.hasApiKey = await this.apiKeys.hasApiKey();
        this.fireState();
    }

    private fireState(): void {
        this.stateEmitter.fire(this.getState());
    }

    cancel(task?: AITask): void {
        if (task) {
            this.running.get(task)?.abort();
            return;
        }
        for (const controller of this.running.values()) {
            controller.abort();
        }
    }

    // ------------------------------------------------------------------
    // EPIC 07: API key, connection test, model selection
    // ------------------------------------------------------------------

    async setApiKey(): Promise<void> {
        if (await this.apiKeys.promptForApiKey()) {
            await this.refreshStatus();
            const choice = await vscode.window.showInformationMessage(
                'Đã lưu Gemini API key an toàn trong SecretStorage.',
                'Kiểm tra kết nối'
            );
            if (choice) {
                await this.testConnection();
            }
        }
    }

    async clearApiKey(): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            'Xóa Gemini API key đã lưu?', { modal: true }, 'Xóa'
        );
        if (confirm === 'Xóa') {
            await this.apiKeys.deleteApiKey();
            await this.refreshStatus();
            void vscode.window.showInformationMessage('Đã xóa API key.');
        }
    }

    async testConnection(): Promise<void> {
        const result = await this.runTask('test', 'Đang kiểm tra kết nối AI...', 'notification',
            signal => this.ai.testConnection(signal), { needsConsent: false });
        if (result) {
            void vscode.window.showInformationMessage(
                `✓ Kết nối ${result.provider} thành công · model ${result.model} · ${result.latencyMs} ms · trả lời: "${result.reply.slice(0, 40)}"`
            );
        }
    }

    async selectModel(): Promise<void> {
        const models = await this.runTask('models', 'Đang tải danh sách model...', 'notification',
            signal => this.ai.listModels(signal), { needsConsent: false });
        if (!models) {
            return;
        }
        const current = this.ai.model;
        const picked = await vscode.window.showQuickPick(
            models.map(model => ({ label: model, description: model === current ? 'đang dùng' : undefined })),
            { placeHolder: `Chọn model Gemini (hiện tại: ${current})`, matchOnDescription: true }
        );
        if (picked) {
            await vscode.workspace.getConfiguration('aiGitAssistant.ai')
                .update('model', picked.label, vscode.ConfigurationTarget.Global);
            void vscode.window.showInformationMessage(`Đã chọn model ${picked.label}.`);
        }
    }

    // ------------------------------------------------------------------
    // EPIC 09: commit message
    // ------------------------------------------------------------------

    /** Returns the generated message, or undefined if cancelled/failed (already reported). */
    async generateCommitMessage(scope: 'staged' | 'auto' = 'staged'): Promise<string | undefined> {
        const result = await this.runTask('commit', 'AI đang tạo commit message...', 'view',
            signal => this.commitFeature.generate({ scope, signal }));
        if (result) {
            this.logContext('commit message', result.context);
        }
        return result?.message;
    }

    /** Fills the built-in Source Control input box. */
    async generateCommitMessageForScm(sourceControl?: { rootUri?: vscode.Uri }): Promise<void> {
        const repository = await this.findScmRepository(sourceControl?.rootUri);
        if (!repository) {
            void vscode.window.showWarningMessage('Không tìm thấy Git repository của workspace trong Source Control.');
            return;
        }
        const message = await this.generateCommitMessage('auto');
        if (message) {
            repository.inputBox.value = message;
            void vscode.commands.executeCommand('workbench.view.scm');
        }
    }

    // ------------------------------------------------------------------
    // EPIC 10 / 11: explain diff, code review
    // ------------------------------------------------------------------

    async explainChanges(scope: GitDiffScope = 'auto'): Promise<void> {
        this.panel.showLoading('AI Explain Diff', 'AI đang phân tích thay đổi...');
        const result = await this.runTask('explain', 'AI đang giải thích thay đổi...', 'notification',
            signal => this.explainFeature.explain(scope, signal));
        if (!result) {
            this.panel.disposeIfLoading();
            return;
        }
        this.logContext('explain', result.context);
        this.panel.showMarkdown('AI Explain Diff', result.markdown, {
            subtitle: `${scopeLabel(result.context)} · ${result.stats.files} file · +${result.stats.additions} −${result.stats.deletions} · ${this.ai.model}`,
            notes: contextNotes(result.context)
        });
    }

    async reviewChanges(scope: GitDiffScope = 'auto'): Promise<void> {
        this.panel.showLoading('AI Code Review', 'AI đang review code...');
        const result = await this.runTask('review', 'AI đang review code...', 'notification',
            signal => this.reviewFeature.review(scope, signal));
        if (!result) {
            this.panel.disposeIfLoading();
            return;
        }
        this.logContext('review', result.context);
        const stats = computeDiffStats(result.context.diff.files);
        this.panel.showReview('AI Code Review', result, {
            subtitle: `${scopeLabel(result.context)} · ${stats.files} file · +${stats.additions} −${stats.deletions} · ${this.ai.model}`,
            notes: contextNotes(result.context)
        });
    }

    // ------------------------------------------------------------------
    // EPIC 12: chat
    // ------------------------------------------------------------------

    /** Returns true when the question was answered. */
    async chat(question: string): Promise<boolean> {
        if (!question.trim()) {
            return false;
        }
        const answer = await this.runTask('chat', 'AI đang trả lời...', 'view',
            signal => this.chatSession.ask(question, signal));
        if (answer) {
            await this.context.workspaceState.update(CHAT_KEY, this.chatSession.history);
            this.fireState();
        }
        return Boolean(answer);
    }

    async clearChat(): Promise<void> {
        this.cancel('chat');
        this.chatSession.clear();
        await this.context.workspaceState.update(CHAT_KEY, []);
        this.fireState();
    }

    // ------------------------------------------------------------------
    // EPIC 13: summaries and merge conflict assistant
    // ------------------------------------------------------------------

    async summarizeHistory(): Promise<void> {
        const picked = await vscode.window.showQuickPick(
            ['20', '50', '100'].map(count => ({ label: `${count} commit gần nhất`, count: Number(count) })),
            { placeHolder: 'Tóm tắt bao nhiêu commit?' }
        );
        if (!picked) {
            return;
        }
        this.panel.showLoading('AI History Summary', 'AI đang tóm tắt lịch sử commit...');
        const result = await this.runTask('historySummary', 'AI đang tóm tắt lịch sử commit...', 'notification',
            signal => this.summaryFeature.summarizeHistory(picked.count, signal));
        if (!result) {
            this.panel.disposeIfLoading();
            return;
        }
        this.panel.showMarkdown(result.title, result.markdown, { subtitle: this.ai.model });
    }

    async summarizeBranch(): Promise<void> {
        const base = await this.pickBaseBranch();
        if (!base) {
            return;
        }
        this.panel.showLoading('AI Branch Summary', `AI đang so sánh branch hiện tại với ${base}...`);
        const result = await this.runTask('branchSummary', 'AI đang tóm tắt branch...', 'notification',
            signal => this.summaryFeature.summarizeBranch(base, signal));
        if (!result) {
            this.panel.disposeIfLoading();
            return;
        }
        this.panel.showMarkdown(result.title, result.markdown, { subtitle: this.ai.model });
    }

    /** Returns true if the file was changed (caller should refresh). */
    async suggestConflictResolution(filePath: string): Promise<boolean> {
        const uri = vscode.Uri.file(this.resolveInWorkspace(filePath));
        const document = await vscode.workspace.openTextDocument(uri);
        const original = document.getText();

        const suggestion = await this.runTask('conflict', `AI đang đề xuất cách giải quyết conflict cho ${path.basename(filePath)}...`, 'notification',
            signal => this.conflictFeature.suggest(filePath, original, signal));
        if (!suggestion) {
            return false;
        }

        const id = `${Date.now()}`;
        this.proposals.set(id, suggestion.resolvedContent);
        const proposalUri = vscode.Uri.from({ scheme: PROPOSAL_SCHEME, path: `/${filePath}`, query: id });
        const explanation = [
            suggestion.summary,
            '',
            ...suggestion.explanations.map(item => `- **Conflict ${item.index + 1}:** ${item.explanation}`)
        ].join('\n');
        this.panel.showMarkdown(`AI Conflict: ${path.basename(filePath)}`, explanation, {
            subtitle: `${suggestion.conflictCount} conflict · ${this.ai.model}`,
            notes: ['Xem diff bên cạnh để kiểm tra đề xuất trước khi áp dụng. AI có thể sai — hãy đọc kỹ.']
        });
        await vscode.commands.executeCommand('vscode.diff', uri, proposalUri,
            `${path.basename(filePath)} ↔ AI đề xuất`, { viewColumn: vscode.ViewColumn.One });

        const choice = await vscode.window.showInformationMessage(
            `Áp dụng cách giải quyết AI đề xuất cho ${filePath}?`,
            'Áp dụng', 'Áp dụng & Mark resolved', 'Bỏ qua'
        );
        this.proposals.delete(id);
        if (choice !== 'Áp dụng' && choice !== 'Áp dụng & Mark resolved') {
            return false;
        }
        if (document.getText() !== original) {
            void vscode.window.showWarningMessage('File đã thay đổi trong lúc chờ AI. Hãy chạy lại đề xuất.');
            return false;
        }

        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), suggestion.resolvedContent);
        if (!await vscode.workspace.applyEdit(edit) || !await document.save()) {
            void vscode.window.showErrorMessage('Không thể ghi file.');
            return false;
        }
        if (choice === 'Áp dụng & Mark resolved') {
            await this.deps.conflict.markConflictResolved(filePath);
        }
        void vscode.window.showInformationMessage(`Đã áp dụng đề xuất của AI cho ${filePath}.`);
        return true;
    }

    // ------------------------------------------------------------------
    // Task runner: readiness, progress, cancellation, errors (TASK 7.5)
    // ------------------------------------------------------------------

    private async runTask<T>(
        task: AITask,
        title: string,
        location: 'notification' | 'view',
        work: (signal: AbortSignal) => Promise<T>,
        options: { needsConsent?: boolean } = {}
    ): Promise<T | undefined> {
        if (this.running.has(task)) {
            void vscode.window.showInformationMessage('Yêu cầu trước đó vẫn đang chạy, vui lòng đợi.');
            return undefined;
        }
        if (!await this.ensureReady(options.needsConsent !== false)) {
            return undefined;
        }

        const controller = new AbortController();
        this.running.set(task, controller);
        this.fireState();
        try {
            return await vscode.window.withProgress({
                location: location === 'notification'
                    ? vscode.ProgressLocation.Notification
                    : { viewId: SIDEBAR_VIEW_ID },
                title,
                cancellable: true
            }, (_progress, token) => {
                token.onCancellationRequested(() => controller.abort());
                return work(controller.signal);
            });
        } catch (error) {
            await this.reportError(error);
            return undefined;
        } finally {
            this.running.delete(task);
            this.fireState();
        }
    }

    private async ensureReady(needsConsent: boolean): Promise<boolean> {
        if (!this.ai.isEnabled()) {
            const choice = await vscode.window.showWarningMessage('Tính năng AI đang tắt.', 'Bật AI');
            if (choice !== 'Bật AI') {
                return false;
            }
            await vscode.workspace.getConfiguration('aiGitAssistant.ai')
                .update('enabled', true, vscode.ConfigurationTarget.Global);
        }
        if (!await this.ai.isConfigured()) {
            const choice = await vscode.window.showWarningMessage(
                'Chưa có Gemini API key. Nhập key để dùng tính năng AI.', 'Nhập API Key'
            );
            if (choice !== 'Nhập API Key' || !await this.apiKeys.promptForApiKey()) {
                return false;
            }
            await this.refreshStatus();
        }
        if (needsConsent && !this.context.globalState.get<boolean>(CONSENT_KEY)) {
            const choice = await vscode.window.showWarningMessage(
                'AI Git Assistant sẽ gửi diff, tên file và lịch sử commit của repository tới Google Gemini để phân tích.',
                {
                    modal: true,
                    detail: 'File nhạy cảm (.env, *.pem, *.key, ...) không được gửi và các giá trị giống secret/API key được tự động che. Không dùng với code bạn không được phép chia sẻ.'
                },
                'Đồng ý'
            );
            if (choice !== 'Đồng ý') {
                return false;
            }
            await this.context.globalState.update(CONSENT_KEY, true);
        }
        return true;
    }

    private async reportError(error: unknown): Promise<void> {
        this.output.appendLine(`${new Date().toISOString()} ERROR ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);

        if (error instanceof FeatureUnavailableError) {
            void vscode.window.showWarningMessage(error.message);
            return;
        }
        if (error instanceof AIError && error.code === 'CANCELLED') {
            vscode.window.setStatusBarMessage('AI: đã hủy yêu cầu.', 3000);
            return;
        }

        const message = describeAIError(error);
        if (error instanceof AIError) {
            if (error.code === 'MISSING_API_KEY' || error.code === 'INVALID_API_KEY') {
                if (await vscode.window.showErrorMessage(message, 'Nhập API Key') === 'Nhập API Key') {
                    await this.setApiKey();
                }
                return;
            }
            if (error.code === 'MODEL_NOT_FOUND') {
                if (await vscode.window.showErrorMessage(message, 'Chọn model') === 'Chọn model') {
                    await this.selectModel();
                }
                return;
            }
        }
        if (await vscode.window.showErrorMessage(message, 'Xem log') === 'Xem log') {
            this.output.show(true);
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private readServiceSettings(): AIServiceSettings {
        const config = vscode.workspace.getConfiguration('aiGitAssistant.ai');
        return {
            enabled: config.get<boolean>('enabled', true),
            model: config.get<string>('model', ''),
            timeoutMs: Math.max(5, config.get<number>('timeoutSeconds', 60)) * 1000
        };
    }

    private readPreferences(): AIPreferences {
        const config = vscode.workspace.getConfiguration('aiGitAssistant.ai');
        const style = config.get<string>('commitMessageStyle', DEFAULT_PREFERENCES.commitStyle);
        return {
            responseLanguage: config.get<string>('responseLanguage', DEFAULT_PREFERENCES.responseLanguage),
            commitLanguage: config.get<string>('commitMessageLanguage', DEFAULT_PREFERENCES.commitLanguage),
            commitStyle: style === 'simple' ? 'simple' : 'conventional',
            maxContextChars: Math.max(2000, config.get<number>('maxContextChars', DEFAULT_PREFERENCES.maxContextChars)),
            excludePatterns: config.get<string[]>('excludeFiles', [...DEFAULT_EXCLUDE_PATTERNS]),
            redactSecrets: config.get<boolean>('redactSecrets', true)
        };
    }

    private logContext(feature: string, context: GitContext): void {
        const stats = computeDiffStats(context.diff.files);
        this.output.appendLine(
            `${new Date().toISOString()} [${feature}] context: ${scopeLabel(context)}, ${stats.files} file(s), ` +
            `${context.diff.text.length}/${context.diff.originalChars} chars sent, ` +
            `${context.diff.omitted.length} omitted, ${context.diff.truncatedFiles.length} truncated, ${context.diff.redactions} redaction(s)`
        );
    }

    private async pickBaseBranch(): Promise<string | undefined> {
        const branches = await this.deps.branch.getBranches();
        const current = branches.find(branch => branch.current)?.name;
        const preferred = ['main', 'master', 'develop', 'origin/main', 'origin/master', 'origin/develop'];
        const names = branches
            .map(branch => branch.name)
            .filter(name => name !== current)
            .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
        function rank(name: string): number {
            const index = preferred.indexOf(name);
            return index < 0 ? preferred.length : index;
        }
        if (names.length === 0) {
            void vscode.window.showWarningMessage('Không có branch nào khác để so sánh.');
            return undefined;
        }
        return vscode.window.showQuickPick(names, {
            placeHolder: `So sánh branch "${current ?? 'HEAD'}" với branch gốc nào?`
        });
    }

    private async findScmRepository(rootUri?: vscode.Uri): Promise<GitExtensionApi['repositories'][number] | undefined> {
        const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitExtensionApi }>('vscode.git');
        if (!extension) {
            return undefined;
        }
        const exports = extension.isActive ? extension.exports : await extension.activate();
        const repositories = exports.getAPI(1).repositories;
        const target = (rootUri?.fsPath ?? this.deps.workspaceRoot).toLowerCase();
        return repositories.find(repo => repo.rootUri.fsPath.toLowerCase() === target)
            ?? repositories.find(repo => target.startsWith(repo.rootUri.fsPath.toLowerCase()))
            ?? (rootUri ? undefined : repositories[0]);
    }

    private resolveInWorkspace(filePath: string): string {
        const root = path.resolve(this.deps.workspaceRoot);
        const absolute = path.resolve(root, filePath);
        const relative = path.relative(root, absolute);
        if (!filePath || relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error('Đường dẫn file nằm ngoài workspace.');
        }
        return absolute;
    }

    async openFileAt(filePath: string, line?: number): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(this.resolveInWorkspace(filePath)));
            const position = new vscode.Position(Math.max(0, (line ?? 1) - 1), 0);
            await vscode.window.showTextDocument(document, {
                viewColumn: vscode.ViewColumn.One,
                selection: new vscode.Range(position, position)
            });
        } catch (error) {
            void vscode.window.showWarningMessage(`Không mở được ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

function scopeLabel(context: GitContext): string {
    switch (context.diffScope) {
        case 'staged': return 'Thay đổi đã stage';
        case 'working': return 'Thay đổi chưa stage';
        case 'all': return 'Tất cả thay đổi chưa commit';
        case 'range': return `So sánh ${context.range}`;
        default: return 'Không có diff';
    }
}

function contextNotes(context: GitContext): string[] {
    const notes: string[] = [];
    if (context.diff.truncatedFiles.length) {
        notes.push(`Diff quá lớn nên đã được rút gọn: ${context.diff.truncatedFiles.join(', ')}.`);
    }
    const omitted = context.diff.omitted.filter(item => item.reason !== 'binary');
    if (omitted.length) {
        notes.push(`Không gửi nội dung: ${omitted.map(item => `${item.path} (${item.reason === 'sensitive' ? 'file nhạy cảm' : 'file sinh tự động'})`).join(', ')}.`);
    }
    if (context.diff.redactions) {
        notes.push(`Đã che ${context.diff.redactions} giá trị giống secret/API key trước khi gửi cho AI.`);
    }
    return notes;
}
