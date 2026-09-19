// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { GitCommandExecutor } from './git/executor/GitCommandExecutor';
import { GitStatusService } from './git/services/GitStatus.service';
import { GitChangesProvider } from './ui/GitChangesProvider';

import { GitDiffService } from './git/services/GitDiff.service';
import { GitDiffContentProvider } from './ui/GitDiffContentProvider';
import * as path from 'path';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "ai-git-asistant" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('ai-git-asistant.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from ai git assistant extension!');
	});

	context.subscriptions.push(disposable);

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
}

// This method is called when your extension is deactivated
export function deactivate() {}
