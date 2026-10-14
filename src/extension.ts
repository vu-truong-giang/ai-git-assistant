import * as vscode from 'vscode';
import { GitCommandExecutor } from './git/executor/GitCommandExecutor';
import { GitStatusService } from './git/services/GitStatus.service';
import { GitChangesWebviewProvider } from './ui/GitChangesWebviewProvider';
import { GitDiffService } from './git/services/GitDiff.service';
import { GitDiffContentProvider } from './ui/GitDiffContentProvider';
import * as path from 'path';
import { WorkspaceService } from './workspace/workspaceService.service';
import { IWorkspaceService } from './workspace/IWorkspaceService.interface';
import { GitRepositoryService } from './git/services/GitRepositoryService';
import { IGitRepositoryService } from './git/interfaces/IGitRepositoryService';
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
        vscode.window.showInformationMessage(`Name: ${wsName}`);
        if(!wsFolder){
          vscode.window.showWarningMessage(' not find folder');
        } else {
          vscode.window.showInformationMessage(`Folder: ${wsFolder}`);
        }
        vscode.window.showInformationMessage(`Workspace path: ${wsPath}`);
        }
    );
    context.subscriptions.push(workspaceCommand);

  if (wsPath) {
		const executor = new GitCommandExecutor(wsPath);
    // Git Repository 
    const repositoryService: IGitRepositoryService = new GitRepositoryService();
    const checkGitRepositoryCmd =
    vscode.commands.registerCommand(
      'ai-git-assistant.checkGitRepository',
      async () => {

        const result = await repositoryService.checkRepository(wsPath);

        if (!result.isGitRepository) {

          vscode.window.showWarningMessage(
            'Current workspace is not a Git repository.'
          );

          return;
        }

        vscode.window.showInformationMessage(
          `Git repository detected: ${result.repositoryRoot}`
        );

        console.log(
          'Git repository root:',
          result.repositoryRoot
        );
      }
    );

    // =========================
    // Git Status & Webview UI
    // =========================
    const statusService = new GitStatusService(executor);
    const gitChangesWebviewProvider = new GitChangesWebviewProvider(context.extensionUri, statusService);

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(GitChangesWebviewProvider.viewType, gitChangesWebviewProvider)
    );

    // =========================
    // Git Diff
    // =========================
    const diffService = new GitDiffService(executor);
    const diffProvider = new GitDiffContentProvider(diffService);

    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(GitDiffContentProvider.scheme, diffProvider)
    );
    
		const refreshCmd = vscode.commands.registerCommand('aiGitAssistant.refreshChanges', () => {
      gitChangesWebviewProvider.updateHtml();
		});

		const openDiffCmd = vscode.commands.registerCommand('aiGitAssistant.openDiff', async (filePath: string) => {
      const currentUri = vscode.Uri.file(path.join(wsPath, filePath));
			
			const headUri = vscode.Uri.parse(`${GitDiffContentProvider.scheme}:${filePath}?HEAD`);
			
			const title = `${filePath} (Working Tree)`;
			
			await vscode.commands.executeCommand('vscode.diff', headUri, currentUri, title);
		});


		context.subscriptions.push(checkGitRepositoryCmd , refreshCmd, openDiffCmd);
	}

}
export function deactivate(): void {}
