
import * as vscode from 'vscode';
import * as path from 'path';

import { GitStatusService } from '../git/services/GitStatus.service';
import { WorkspaceService } from '../workspace/workspaceService.service';
import { GitBranchService } from '../git/services/GitBranch.service';

export class AiGitAssistantViewProvider
    implements vscode.WebviewViewProvider {

    public static readonly viewType = 'aiGitAssistant.overview';

    private view?: vscode.WebviewView;
    private refreshTimer?: ReturnType<typeof setTimeout>;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly statusService: GitStatusService,
        private readonly workspaceService: WorkspaceService,
        private readonly branchService: GitBranchService
    ) {}

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'webview')
            ]
        };

        webviewView.webview.html = this.getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async message => {
            if (message.command === 'refresh') {
                await this.refresh();
            }

            if (message.command === 'showFile') {
                const filePath = String(message.filePath ?? '');
                await this.openFile(filePath);
            }

            if (message.command === 'openChanges') {
                if (!this.workspaceService.hasWorkspace()) {
                    void vscode.window.showWarningMessage(
                        'Please open a workspace before viewing Git changes.'
                    );
                    return;
                }

                await vscode.commands.executeCommand(
                    'aiGitAssistant.openChanges'
                );
            }
        });

        void this.refresh();
    }

    async refresh(): Promise<void> {
        if (!this.view) {
            return;
        }

        const webview = this.view.webview;
        const workspacePath = this.workspaceService.getWorkspacePath();

        if (!workspacePath) {
            webview.postMessage({
                command: 'update',
                data: {
                    hasRepository: false,
                    message: 'Vui lòng mở một workspace trong VS Code.'
                }
            });
            return;
        }

        try {
            const [
                files,
                aheadBehind,
                trackingBranch,
                branch
            ] = await Promise.all([
                this.statusService.getStatus(),
                this.statusService.getAheadBehind(),
                this.branchService.getTrackingBranch(),
                this.branchService.getCurrentBranch()
            ]);

            const repositoryName = path.basename(workspacePath);

            webview.postMessage({
                command: 'update',
                data: {
                    hasRepository: true,
                    repositoryName,
                    repositoryPath: workspacePath,
                    branch: branch.name,
                    trackingBranch,
                    ahead: aheadBehind.ahead,
                    behind: aheadBehind.behind,
                    files: files.map(file => ({
                        filePath: file.filePath,
                        status: file.status,
                        staged: file.staged
                    }))
                }
            });
        } catch (error) {
            webview.postMessage({
                command: 'update',
                data: {
                    hasRepository: false,
                    message: `Không thể lấy Git status: ${String(error)}`
                }
            });
        }
    }

    private async openFile(filePath: string): Promise<void> {
        const workspacePath = this.workspaceService.getWorkspacePath();

        if (!workspacePath || !filePath) {
            return;
        }

        const root = path.resolve(workspacePath);
        const absolutePath = path.resolve(root, filePath);
        const relativePath = path.relative(root, absolutePath);

        // Không cho phép đường dẫn thoát khỏi workspace.
        if (
            relativePath === '..' ||
            relativePath.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relativePath)
        ) {
            return;
        }

        try {
            const document = await vscode.workspace.openTextDocument(
                vscode.Uri.file(absolutePath)
            );

            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showErrorMessage(
                `Không thể mở file: ${String(error)}`
            );
        }
    }

    private getHtml(webview: vscode.Webview): string {
        const webviewDir = vscode.Uri.joinPath(
            this.extensionUri,
            'src',
            'ui',
            'webview'
        );

        const cssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(webviewDir, 'style.css')
        );

        const jsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(webviewDir, 'main.js')
        );

        const nonce = getNonce();

        return `
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta
        http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource};
        script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${cssUri}">
    <title>AI Git Assistant</title>
</head>
<body>
    <header class="header">
        <div class="brand-icon">AI</div>
        <div>
            <h1>AI Git Assistant</h1>
            <p>Repository Overview</p>
        </div>
        <button id="refreshButton" class="icon-button" title="Refresh">↻</button>
    </header>

    <main>
        <section class="repo-card">
            <div class="section-heading">
                <span class="eyebrow">REPOSITORY</span>
                <span id="repoState" class="badge">Checking...</span>
            </div>

            <h2 id="repoName">Loading repository...</h2>
            <p id="repoPath" class="muted path"></p>

            <div class="divider"></div>

            <span class="eyebrow">CURRENT BRANCH</span>
            <p id="branchName" class="branch-name">—</p>
            <p id="trackingBranch" class="muted">Tracking: —</p>
        </section>

        <section class="stats-grid">
            <article class="stat-card">
                <span class="stat-label">Ahead ↑</span>
                <strong id="aheadCount">0</strong>
                <span class="muted">commits</span>
            </article>
            <article class="stat-card">
                <span class="stat-label">Behind ↓</span>
                <strong id="behindCount">0</strong>
                <span class="muted">commits</span>
            </article>
        </section>

        <section class="changes-card">
            <div class="section-heading">
                <h2>Changes</h2>
                <span id="changeCount" class="badge">0 files</span>
            </div>

            <div class="change-summary">
                <span id="stagedCount">Staged: 0</span>
                <span id="unstagedCount">Unstaged: 0</span>
            </div>

            <div id="fileList" class="file-list">
                <p class="muted">Đang tải dữ liệu Git...</p>
            </div>
        </section>

        <section class="insight-card">
            <h2>Repository Insights</h2>
            <p id="insightText" class="muted">
                Đang phân tích trạng thái repository...
            </p>
        </section>

        <button id="detailsButton" class="primary-button">
            View Repository Status
        </button>

        <p id="message" class="message" role="status"></p>
    </main>

    <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
    }

    dispose(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
    }
}

function getNonce(): string {
    const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';

    for (let i = 0; i < 32; i++) {
        value += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return value;
}
