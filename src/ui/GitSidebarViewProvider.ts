import * as path from 'path';
import * as vscode from 'vscode';
import { GitCommandExecutor } from '../git/executor/GitCommandExecutor';
import { GitBranchService } from '../git/services/GitBranch.service';
import { GitCommitService } from '../git/services/GitCommit.service';
import { GitConflictService } from '../git/services/GitConflict.service';
import { GitRemoteService } from '../git/services/GitRemote.service';
import { GitStatusService } from '../git/services/GitStatus.service';
import { IWorkspaceService } from '../workspace/IWorkspaceService.interface';

interface SidebarMessage {
    command?: string;
    filePath?: string;
    message?: string;
    branch?: string;
    action?: string;
    resolution?: 'ours' | 'theirs';
}

export class GitSidebarViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiGitAssistant.overview';

    private view?: vscode.WebviewView;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly workspaceService: IWorkspaceService,
        private readonly executor: GitCommandExecutor,
        private readonly statusService: GitStatusService,
        private readonly branchService: GitBranchService,
        private readonly commitService: GitCommitService,
        private readonly conflictService: GitConflictService,
        private readonly remoteService: GitRemoteService
    ) {}

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'webview')
            ]
        };
        view.webview.html = this.getHtml(view.webview);
        view.webview.onDidReceiveMessage((message: SidebarMessage) => {
            void this.handleMessage(message);
        });
        void this.refresh();
    }

    async refresh(): Promise<void> {
        if (!this.view) {
            return;
        }

        if (!this.workspaceService.hasWorkspace()) {
            this.postData({
                error: 'Mở một workspace để sử dụng AI Git Assistant.'
            });
            return;
        }

        try {
            const workspacePath = this.workspaceService.getWorkspacePath();
            if (!workspacePath) {
                throw new Error('Không xác định được đường dẫn workspace.');
            }

            await this.executor.execute(['rev-parse', '--is-inside-work-tree']);
            const [files, branch, trackingBranch, aheadBehind, branches,
                remotes, conflicts] = await Promise.all([
                this.statusService.getStatus(),
                this.branchService.getCurrentBranch(),
                this.branchService.getTrackingBranch(),
                this.statusService.getAheadBehind(),
                this.branchService.getBranches(),
                this.remoteService.getRemotes(),
                this.conflictService.getConflicts()
            ]);

            const historyOutput = await this.executor.execute([
                'log',
                '-n',
                '40',
                '--format=%h%x1f%s%x1f%an%x1f%aI'
            ]).catch(error => {
                if (String(error).includes('does not have any commits yet')) {
                    return '';
                }
                throw error;
            });

            const history = historyOutput
                .split(/\r?\n/)
                .filter(Boolean)
                .map(line => {
                    const [hash, message, author, date] = line.split('\x1f');
                    return { hash, message, author, date };
                });

            this.postData({
                repositoryName: path.basename(workspacePath),
                repositoryPath: workspacePath,
                files,
                branch: branch.name,
                trackingBranch,
                ahead: aheadBehind.ahead,
                behind: aheadBehind.behind,
                branches,
                remotes,
                conflicts,
                history
            });
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.postData({ error: `Không thể tải repository: ${detail}` });
        }
    }

    showPage(page: string): void {
        this.view?.webview.postMessage({ command: 'navigate', page });
    }

    private async handleMessage(message: SidebarMessage): Promise<void> {
        try {
            switch (message.command) {
                case 'refresh':
                    await this.refresh();
                    return;
                case 'stage':
                    await this.runPathCommand(['add'], message.filePath);
                    break;
                case 'unstage':
                    await this.runPathCommand(
                        ['restore', '--staged'],
                        message.filePath
                    );
                    break;
                case 'commit': {
                    const commitMessage = message.message?.trim();
                    if (!commitMessage) {
                        void vscode.window.showWarningMessage(
                            'Nhập nội dung commit trước khi tiếp tục.'
                        );
                        return;
                    }
                    await this.commitService.commit(commitMessage);
                    void vscode.window.showInformationMessage('Commit thành công.');
                    break;
                }
                case 'generateCommitMessage':
                    void vscode.window.showInformationMessage(
                        'AI chưa được kết nối. Hãy cấu hình AI provider trong Settings để tạo commit message.'
                    );
                    await vscode.commands.executeCommand(
                        'workbench.action.openSettings',
                        'aiGitAssistant.ai'
                    );
                    return;
                case 'createBranch': {
                    const branchName = await vscode.window.showInputBox({
                        prompt: 'Nhập tên branch mới',
                        validateInput: value =>
                            value.trim()
                                ? undefined
                                : 'Tên branch không được để trống.'
                    });
                    if (!branchName) {
                        return;
                    }
                    await this.branchService.createBranch(branchName.trim(), true);
                    break;
                }
                case 'switchBranch':
                    if (message.branch) {
                        await this.branchService.switchBranch(message.branch);
                    }
                    break;
                case 'resolveConflict':
                    if (message.filePath && message.resolution) {
                        await this.conflictService.resolveConflict(
                            message.filePath,
                            message.resolution
                        );
                    }
                    break;
                case 'sync':
                    await this.sync(message.action);
                    break;
                case 'openAiSettings':
                    await vscode.commands.executeCommand(
                        'workbench.action.openSettings',
                        'aiGitAssistant.ai'
                    );
                    return;
                case 'openFile':
                    await this.openFile(message.filePath);
                    return;
                default:
                    return;
            }

            await this.refresh();
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Thao tác thất bại: ${detail}`);
        }
    }

    private async runPathCommand(
        args: string[],
        filePath: string | undefined
    ): Promise<void> {
        const safePath = this.resolveWorkspaceFile(filePath);
        await this.executor.execute([...args, '--', safePath]);
    }

    private async openFile(filePath: string | undefined): Promise<void> {
        const absolutePath = this.resolveWorkspaceFile(filePath);
        const document = await vscode.workspace.openTextDocument(
            vscode.Uri.file(absolutePath)
        );
        await vscode.window.showTextDocument(document);
    }

    private resolveWorkspaceFile(filePath: string | undefined): string {
        const workspacePath = this.workspaceService.getWorkspacePath();
        if (!workspacePath || !filePath) {
            throw new Error('Không tìm thấy workspace hoặc đường dẫn file.');
        }

        const root = path.resolve(workspacePath);
        const absolutePath = path.resolve(root, filePath);
        const relativePath = path.relative(root, absolutePath);
        if (
            relativePath === '..' ||
            relativePath.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relativePath)
        ) {
            throw new Error('Đường dẫn file nằm ngoài workspace.');
        }
        return absolutePath;
    }

    private async sync(action: string | undefined): Promise<void> {
        switch (action) {
            case 'fetch':
                await this.remoteService.fetch();
                break;
            case 'pull':
                await this.remoteService.pull();
                break;
            case 'push':
                await this.remoteService.push();
                break;
            default:
                throw new Error('Thao tác Sync không hợp lệ.');
        }
        void vscode.window.showInformationMessage(`${action} hoàn tất.`);
    }

    private postData(data: Record<string, unknown>): void {
        void this.view?.webview.postMessage({ command: 'update', data });
    }

    private getHtml(webview: vscode.Webview): string {
        const webviewDir = vscode.Uri.joinPath(
            this.extensionUri,
            'src',
            'ui',
            'webview'
        );
        const cssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(webviewDir, 'sidebar.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(webviewDir, 'sidebar.js')
        );
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <link rel="stylesheet" href="${cssUri}">
    <title>AI Git Assistant</title>
</head>
<body>
    <header class="app-header">
        <div class="brand-mark">AI</div>
        <div class="brand-copy"><strong>AI Git Assistant</strong><span>VS Code Extension</span></div>
        <button id="refresh" class="icon-button" type="button" title="Làm mới">↻</button>
    </header>
    <div class="workspace-strip">
        <span class="repo-dot"></span>
        <span id="workspaceName">Đang tải workspace...</span>
        <button id="workspaceRefresh" class="icon-button" type="button" title="Làm mới">···</button>
    </div>
    <div class="app-layout">
        <nav class="app-nav" aria-label="Điều hướng">
            <button class="nav-item active" data-page="overview"><span>⌂</span><b>Overview</b></button>
            <button class="nav-item" data-page="changes"><span>▤</span><b>Changes</b><i id="changeBadge">0</i></button>
            <button class="nav-item" data-page="commit"><span>✓</span><b>Commit</b></button>
            <button class="nav-item" data-page="branches"><span>⑂</span><b>Branches</b></button>
            <button class="nav-item" data-page="conflict"><span>⚠</span><b>Conflict</b><i id="conflictBadge">0</i></button>
            <button class="nav-item" data-page="history"><span>◷</span><b>History</b></button>
            <button class="nav-item" data-page="sync"><span>⇅</span><b>Sync</b></button>
            <button class="nav-item" data-page="aiChat"><span>◌</span><b>AI Chat</b></button>
            <button class="nav-item nav-settings" data-page="settings"><span>⚙</span><b>Settings</b></button>
        </nav>
        <main class="page-content">
            <div class="page-toolbar">
                <div><span class="eyebrow">AI GIT ASSISTANT</span><h1 id="pageTitle">Overview</h1></div>
                <button id="pageRefresh" class="icon-button" type="button" title="Làm mới">⟳</button>
            </div>
            <div id="content"><p class="muted">Đang tải repository...</p></div>
        </main>
    </div>
    <footer class="status-bar"><span id="currentBranch">⑂ —</span><span>↑ 0 ↓ 0</span></footer>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function getNonce(): string {
    const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';
    for (let index = 0; index < 32; index++) {
        value += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return value;
}
