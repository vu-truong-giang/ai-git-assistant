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
  const wsPath = workspaceService.getWorkspacePath();  
  const wsFolder = workspaceService.getWorkspaceFolder();
  const wsName = workspaceService.getWorkspaceName();
  const isWs = workspaceService.hasWorkspace();

  const workspaceCommand = vscode.commands.registerCommand(
    'ai-git-assistant.getWorkspaceInfo',
    () => {
        if( !isWs ) {
            vscode.window.showWarningMessage('No workspace is opened. Please open a workspace to use AI Git Assistant.');
            return;
        }
        
        if( !wsPath ) {
            vscode.window.showWarningMessage('Cannot determine the workspace path. Please check your workspace settings.');
            return;
        }
        vscode.window.showInformationMessage(`Name: ${wsName}`)
        if(!wsFolder){
          vscode.window.showWarningMessage(' not find folder');
        } else {
          vscode.window.showInformationMessage(`Folder: ${wsFolder}`);
        }
        vscode.window.showInformationMessage(`Workspace path: ${wsPath}`);
        }
    );
    context.subscriptions.push(workspaceCommand);
}
export function deactivate(): void {}
