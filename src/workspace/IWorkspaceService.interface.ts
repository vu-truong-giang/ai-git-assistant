import * as vscode from 'vscode';

export interface IWorkspaceService {
    getWorkspaceFolder(): vscode.WorkspaceFolder | undefined;

    getWorkspacePath(): string | undefined;

    getWorkspaceName(): string | undefined;

    hasWorkspace(): boolean;

}