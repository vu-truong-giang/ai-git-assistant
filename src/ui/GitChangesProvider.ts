import * as vscode from 'vscode';
import { IStatusService } from '../git/interfaces/StatusService.interface';
import { GitFileStatus, GitFileStatusType } from '../git/models/GitFileStatus.model';

export class GitFileChangeItem extends vscode.TreeItem {
    constructor(
        public readonly fileStatus: GitFileStatus,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command
    ) {
        super(fileStatus.filePath, collapsibleState);
        this.tooltip = `${this.fileStatus.filePath} (Status: ${this.fileStatus.status})`;
        this.description = this.fileStatus.status;

        this.iconPath = this.getIconForStatus(this.fileStatus.status);
    }

    private getIconForStatus(status: GitFileStatusType): vscode.ThemeIcon {
        switch (status) {
            case 'modified':
                return new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
            case 'added':
            case 'untracked':
                return new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
            case 'deleted':
                return new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
            case 'renamed':
                return new vscode.ThemeIcon('diff-renamed', new vscode.ThemeColor('gitDecoration.renamedResourceForeground'));
            case 'ignored':
                return new vscode.ThemeIcon('diff-ignored', new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'));
            default:
                return new vscode.ThemeIcon('file');
        }
    }
}

export class GitChangesProvider implements vscode.TreeDataProvider<GitFileChangeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<GitFileChangeItem | undefined | void> = new vscode.EventEmitter<GitFileChangeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<GitFileChangeItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor(private statusService: IStatusService) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: GitFileChangeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: GitFileChangeItem): Promise<GitFileChangeItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        try {
            const statuses = await this.statusService.getStatus();
            return statuses.map(status => new GitFileChangeItem(
                status,
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'aiGitAssistant.openDiff',
                    title: 'Open Diff',
                    arguments: [status.filePath]
                }
            ));
        } catch {
            vscode.window.showErrorMessage('Error fetching git status');
            return [];
        }
    }
}
