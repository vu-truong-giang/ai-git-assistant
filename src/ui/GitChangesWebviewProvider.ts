import * as vscode from 'vscode';
import { IStatusService } from '../git/interfaces/StatusService.interface';
import { GitFileStatus } from '../git/models/GitFileStatus.model';

export class GitChangesWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiGitAssistantChanges';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _statusService: IStatusService
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        this.updateHtml();
    }

    public async updateHtml() {
        if (!this._view) {
            return;
        }

        const allStatus = await this._statusService.getStatus();
        const staged = allStatus.filter(f => f.staged);
        const unstaged = allStatus.filter(f => !f.staged);

        this._view.webview.html = this.getHtmlForWebview(this._view.webview, staged, unstaged);
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private getHtmlForWebview(webview: vscode.Webview, staged: GitFileStatus[], unstaged: GitFileStatus[]): string {
        const allFiles = [...staged, ...unstaged];
        const modifiedCount = allFiles.filter(f => f.status === 'modified').length;
        const untrackedCount = allFiles.filter(f => f.status === 'untracked').length;

        const nonce = getNonce();

        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
        );

        const renderFile = (f: GitFileStatus) => {
            const escaped = this.escapeHtml(f.filePath);
            let color = 'var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d)';
            let label = 'M';
            let iconClass = 'codicon-file';

            if (f.status === 'untracked') {
                color = 'var(--vscode-gitDecoration-untrackedResourceForeground, #73c991)';
                label = 'U';
                iconClass = 'codicon-file-add';
            } else if (f.status === 'deleted') {
                color = 'var(--vscode-gitDecoration-deletedResourceForeground, #f14c4c)';
                label = 'D';
                iconClass = 'codicon-file-remove'; 
            } else if (f.status === 'added') {
                color = 'var(--vscode-gitDecoration-addedResourceForeground, #81b88b)';
                label = 'A';
                iconClass = 'codicon-file-add';
            } else if (f.status === 'renamed') {
                color = 'var(--vscode-gitDecoration-renamedResourceForeground, #73c991)';
                label = 'R';
                iconClass = 'codicon-file-symlink-file';
            } else if (f.status === 'conflicted') {
                color = 'var(--vscode-gitDecoration-conflictingResourceForeground, #e4676b)';
                label = '!';
                iconClass = 'codicon-warning';
            }

            return `
            <div class="file-row" data-filepath="${escaped}">
                <input type="checkbox" class="file-cb" />
                <span class="file-icon codicon ${iconClass}"></span>
                <span class="file-path">${escaped}</span>
                <span class="file-status" style="color: ${color}">${label}</span>
            </div>`;
        };

        const stagedHtml = staged.length > 0
            ? staged.map(renderFile).join('')
            : '<div class="empty-msg">No staged changes</div>';

        const unstagedHtml = unstaged.length > 0
            ? unstaged.map(renderFile).join('')
            : '<div class="empty-msg">No unstaged changes</div>';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <title>Git Changes</title>
    <link href="${codiconsUri}" rel="stylesheet" />
    <style>
        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif);
            color: var(--vscode-editor-foreground, #cccccc);
            background-color: var(--vscode-editor-background, #1e1e1e);
            padding: 12px;
            margin: 0;
        }
        h2 { font-size: 14px; margin-top: 0; margin-bottom: 10px; font-weight: normal; }
        .header-stats {
            display: flex;
            gap: 15px;
            font-size: 11px;
            margin-bottom: 12px;
        }
        .stat-modified { color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d); }
        .stat-untracked { color: var(--vscode-gitDecoration-untrackedResourceForeground, #73c991); }
        .search-box {
            width: 100%;
            padding: 6px 8px;
            margin-bottom: 15px;
            background: var(--vscode-input-background, #3c3c3c);
            color: var(--vscode-input-foreground, #cccccc);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 3px;
            box-sizing: border-box;
            outline: none;
            font-size: 12px;
        }
        .search-box:focus {
            border-color: var(--vscode-focusBorder, #007fd4);
        }
        .tabs {
            display: flex;
            border-bottom: 1px solid var(--vscode-panel-border, #444);
            margin-bottom: 10px;
            user-select: none;
        }
        .tab {
            padding: 6px 12px;
            font-size: 12px;
            cursor: pointer;
            color: var(--vscode-panelTitle-inactiveForeground, #888);
            border-bottom: 2px solid transparent;
            transition: color 0.15s, border-color 0.15s;
        }
        .tab:hover {
            color: var(--vscode-panelTitle-activeForeground, #fff);
        }
        .tab.active {
            color: var(--vscode-panelTitle-activeForeground, #fff);
            border-bottom-color: var(--vscode-panelTitle-activeForeground, #fff);
        }
        .file-list {
            margin-bottom: 20px;
            min-height: 30px;
        }
        .file-list-content { display: none; }
        .file-list-content.active { display: block; }
        .file-row {
            display: flex;
            align-items: center;
            padding: 3px 0;
            font-size: 12px;
            border-radius: 3px;
            cursor: pointer;
        }
        .file-row:hover {
            background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
        }
        .file-row input { margin-right: 8px; cursor: pointer; accent-color: var(--vscode-checkbox-background, #3c3c3c); }
        .file-icon { margin-right: 6px; font-size: 14px; opacity: 0.8; }
        .file-path { flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .file-status { font-weight: bold; font-size: 11px; margin-left: 8px; min-width: 16px; text-align: center; }
        .empty-msg { font-size: 12px; opacity: 0.6; padding: 10px 0; }
        .card {
            background: var(--vscode-editorWidget-background, #252526);
            border: 1px solid var(--vscode-widget-border, #454545);
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 12px;
        }
        .card-header {
            color: var(--vscode-textLink-foreground, #3794ff);
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 10px;
            display: flex;
            justify-content: space-between;
        }
        .risk-medium { color: var(--vscode-charts-orange, #d18616); font-weight: 600; text-align: right; }
        .ul-insights { padding-left: 18px; margin: 0 0 12px 0; font-size: 12px; line-height: 1.6; }
        .actions { display: flex; gap: 8px; }
        .btn {
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, #fff);
            border: none;
            padding: 6px 12px;
            border-radius: 3px;
            font-size: 12px;
            cursor: pointer;
            flex-grow: 1;
            text-align: center;
            transition: background 0.15s;
        }
        .btn:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground, #3a3d41);
            color: var(--vscode-button-secondaryForeground, #fff);
        }
        .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
        .commit-box {
            background: var(--vscode-input-background, #3c3c3c);
            border: 1px solid var(--vscode-input-border, transparent);
            padding: 8px;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            margin-bottom: 12px;
            border-radius: 3px;
            white-space: pre-wrap;
            color: var(--vscode-input-foreground, #ccc);
        }
    </style>
</head>
<body>
    <h2>Changes</h2>
    <div class="header-stats">
        <span class="stat-modified">${modifiedCount} modified</span>
        <span class="stat-untracked">${untrackedCount} untracked</span>
    </div>
    <input type="text" class="search-box" placeholder="Filter files..." id="filterInput" />
    
    <div class="tabs">
        <div class="tab" data-tab="staged">Staged (${staged.length})</div>
        <div class="tab active" data-tab="unstaged">Unstaged (${unstaged.length})</div>
    </div>

    <div class="file-list">
        <div class="file-list-content" id="staged-list">${stagedHtml}</div>
        <div class="file-list-content active" id="unstaged-list">${unstagedHtml}</div>
    </div>

    <div class="card">
        <div class="card-header">
            <span>AI Analysis</span>
            <span class="risk-medium" style="font-size:10px;">Risk Level<br/><span style="font-size:12px">Medium</span></span>
        </div>
        <div style="font-size:12px; margin-bottom: 6px;">Suggests these changes:</div>
        <ul class="ul-insights">
            <li>Add employee search functionality</li>
            <li>Update pagination logic</li>
            <li>Modify API request and params</li>
        </ul>
        <div class="actions">
            <button class="btn btn-secondary" id="btnExplain">Explain Changes</button>
            <button class="btn" id="btnReview">Review Code</button>
        </div>
    </div>

    <div class="card">
        <div class="card-header" style="font-size:12px; margin-bottom:8px;">Commit Suggestion (AI)</div>
        <div class="commit-box" id="commitMsg">feat(employee): add employee search and pagination support</div>
        <div class="actions">
            <button class="btn btn-secondary" style="flex-grow:0;" id="btnCopy">Copy</button>
            <button class="btn" id="btnUseMsg">Use This Message</button>
        </div>
    </div>

    <script nonce="${nonce}">
        (function() {
            const tabs = document.querySelectorAll('.tab');
            const stagedList = document.getElementById('staged-list');
            const unstagedList = document.getElementById('unstaged-list');
            const filterInput = document.getElementById('filterInput');

            tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    tabs.forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');

                    const target = tab.getAttribute('data-tab');
                    if (target === 'staged') {
                        stagedList.classList.add('active');
                        unstagedList.classList.remove('active');
                    } else {
                        unstagedList.classList.add('active');
                        stagedList.classList.remove('active');
                    }
                });
            });

            filterInput.addEventListener('input', () => {
                const query = filterInput.value.toLowerCase();
                const activeList = document.querySelector('.file-list-content.active');
                if (!activeList) return;

                const rows = activeList.querySelectorAll('.file-row');
                rows.forEach(row => {
                    const path = row.querySelector('.file-path');
                    if (path) {
                        const text = path.textContent.toLowerCase();
                        row.style.display = text.includes(query) ? 'flex' : 'none';
                    }
                });
            });
        })();
    </script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
