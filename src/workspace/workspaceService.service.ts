import * as vscode from 'vscode';

export class WorkspaceService {
    /**
     * Lấy workspace folder hiện tại
     */
    getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
        return vscode.workspace.workspaceFolders?.[0];
    }

    /**
     * Lấy đường dẫn tuyệt đối của workspace
     */
    getWorkspacePath(): string | undefined {
        return this.getWorkspaceFolder()?.uri.fsPath;
    }

    /**
     * Lấy tên workspace
     */
    getWorkspaceName(): string | undefined {
        return this.getWorkspaceFolder()?.name;
    }

    /**
     * Kiểm tra VS Code đã mở workspace chưa
     */
    hasWorkspace(): boolean {
        return !!vscode.workspace.workspaceFolders?.length;
    }
}