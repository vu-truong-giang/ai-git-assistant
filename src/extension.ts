import * as vscode from 'vscode';
import { WorkspaceService } from './workspace/workspaceService.service';
import { IWorkspaceService } from './workspace/IWorkspaceService.interface';
export function activate(context: vscode.ExtensionContext): void {
  const helloWorld = vscode.commands.registerCommand(
    'ai-git-assistant.helloWorld',
    () => {
      void vscode.window.showInformationMessage('AI Git Assistant is ready.');
    }
  );
  context.subscriptions.push(helloWorld);

  const workspaceService: IWorkspaceService = new WorkspaceService();
  const workspaceCommand = vscode.commands.registerCommand(
    'ai-git-assistant.getWorkspaceInfo',
    () => {
        if( !workspaceService.hasWorkspace() ) {
            vscode.window.showWarningMessage('No workspace is opened. Please open a workspace to use AI Git Assistant.');
            return;
        }
        const workspacePath = workspaceService.getWorkspacePath();
        if( !workspacePath ) {
            vscode.window.showWarningMessage('Cannot determine the workspace path. Please check your workspace settings.');
            return;
        }
        vscode.window.showInformationMessage(`Workspace path: ${workspacePath}`);
        }
    );
    context.subscriptions.push(workspaceCommand);
}
export function deactivate(): void {}
