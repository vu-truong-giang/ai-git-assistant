import * as vscode from 'vscode';
import { GitCommandExecutor } from './git/executor/GitCommandExecutor';
import { GitStatusService } from './git/services/GitStatus.service';
import { GitChangesProvider } from './ui/GitChangesProvider';
import { GitDiffService } from './git/services/GitDiff.service';
import { GitDiffContentProvider } from './ui/GitDiffContentProvider';
import * as path from 'path';
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

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "ai-git-assistant" is now active!');

	// Setup Git AI Assistant UI Components
	const workspaceRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
		? vscode.workspace.workspaceFolders[0].uri.fsPath
		: undefined;

	if (workspaceRoot) {
		const executor = new GitCommandExecutor(workspaceRoot);
		const statusService = new GitStatusService(executor);
		const gitChangesProvider = new GitChangesProvider(statusService);
		
		const diffService = new GitDiffService(executor);
		const diffProvider = new GitDiffContentProvider(diffService);

		vscode.window.registerTreeDataProvider('aiGitAssistantChanges', gitChangesProvider);
		
		// Register our custom URI scheme for opening diffs
		context.subscriptions.push(
			vscode.workspace.registerTextDocumentContentProvider(GitDiffContentProvider.scheme, diffProvider)
		);

		const refreshCmd = vscode.commands.registerCommand('aiGitAssistant.refreshChanges', () => {
			gitChangesProvider.refresh();
		});

		const openDiffCmd = vscode.commands.registerCommand('aiGitAssistant.openDiff', async (filePath: string) => {
			// Construct absolute path for the right pane (current file on disk)
			const currentUri = vscode.Uri.file(path.join(workspaceRoot, filePath));
			
			// Construct custom URI for the left pane (file at HEAD)
			const headUri = vscode.Uri.parse(`${GitDiffContentProvider.scheme}:${filePath}?HEAD`);
			
			const title = `${filePath} (Working Tree)`;
			
			// Open the VS Code native diff view
			await vscode.commands.executeCommand('vscode.diff', headUri, currentUri, title);
		});

		context.subscriptions.push(refreshCmd, openDiffCmd);
	}

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
