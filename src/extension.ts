
import * as vscode from 'vscode';
import * as path from 'path';

// ========================================
// Git Layer
// ========================================
import { GitCommandExecutor } from './git/executor/GitCommandExecutor';
import { GitStatusService } from './git/services/GitStatus.service';
import { GitBranchService } from './git/services/GitBranch.service';
import { GitDiffService } from './git/services/GitDiff.service';
import { GitRepositoryService } from './git/services/GitRepositoryService';
import { IGitRepositoryService } from './git/interfaces/IGitRepositoryService';

// ========================================
// UI Layer
// ========================================
import { GitDiffContentProvider } from './ui/GitDiffContentProvider';
import { GitSidebarViewProvider } from './ui/GitSidebarViewProvider';
import { GitCommitService } from './git/services/GitCommit.service';
import { GitConflictService } from './git/services/GitConflict.service';
import { GitRemoteService } from './git/services/GitRemote.service';

// ========================================
// Workspace Layer
// ========================================
import { WorkspaceService } from './workspace/workspaceService.service';
import { IWorkspaceService } from './workspace/IWorkspaceService.interface';

// ========================================
// AI Layer
// ========================================
import { ApiKeyManager } from './ai/ApiKeyManager';
import { AIController } from './ui/AIController';

export function activate(context: vscode.ExtensionContext): void {

    // ========================================
    // 1. Hello World Command
    // ========================================
    const helloWorld = vscode.commands.registerCommand(
        'ai-git-assistant.helloWorld',
        () => {
            void vscode.window.showInformationMessage(
                'AI Git Assistant is ready.'
            );
        }
    );

    context.subscriptions.push(helloWorld);

    // ========================================
    // 2. Initialize Workspace Service
    // ========================================
    const workspaceService: IWorkspaceService =
        new WorkspaceService();

    const wsPath = workspaceService.getWorkspacePath();
    const wsFolder = workspaceService.getWorkspaceFolder();
    const wsName = workspaceService.getWorkspaceName();
    const isWs = workspaceService.hasWorkspace();

    // ========================================
    // 3. Get Workspace Information Command
    // ========================================
    const workspaceCommand = vscode.commands.registerCommand(
        'ai-git-assistant.getWorkspaceInfo',
        () => {

            if (!isWs) {
                void vscode.window.showWarningMessage(
                    'No workspace is opened. Please open a workspace to use AI Git Assistant.'
                );
                return;
            }

            if (!wsPath) {
                void vscode.window.showWarningMessage(
                    'Cannot determine the workspace path. Please check your workspace settings.'
                );
                return;
            }

            void vscode.window.showInformationMessage(
                `Name: ${wsName}`
            );

            if (!wsFolder) {
                void vscode.window.showWarningMessage(
                    'Cannot find workspace folder.'
                );
            } else {
                void vscode.window.showInformationMessage(
                    `Folder: ${wsFolder}`
                );
            }

            void vscode.window.showInformationMessage(
                `Workspace path: ${wsPath}`
            );
        }
    );

    context.subscriptions.push(workspaceCommand);

    // ========================================
    // 5. Initialize Git Command Executor
    // ========================================
    const executor = new GitCommandExecutor(
        wsPath ?? context.extensionPath
    );

    // ========================================
    // 7. Git Status Service
    // ========================================
    const statusService = new GitStatusService(executor);
    const branchService = new GitBranchService(executor, statusService);
    const commitService = new GitCommitService(executor);
    const conflictService = new GitConflictService(
        executor,
        wsPath ?? context.extensionPath
    );
    const remoteService = new GitRemoteService(executor);
    const diffService = new GitDiffService(executor);

    // ========================================
    // 8. AI (EPIC 07-13)
    // ========================================
    const apiKeys = new ApiKeyManager(context.secrets);
    const aiController = wsPath
        ? new AIController(context, apiKeys, {
            workspaceRoot: wsPath,
            status: statusService,
            diff: diffService,
            branch: branchService,
            commit: commitService,
            conflict: conflictService
        })
        : undefined;
    if (aiController) {
        context.subscriptions.push(aiController);
    }
    registerAiCommands(context, apiKeys, aiController);

    const sidebarProvider = new GitSidebarViewProvider(
        context.extensionUri,
        workspaceService,
        executor,
        statusService,
        branchService,
        commitService,
        conflictService,
        remoteService,
        aiController
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            GitSidebarViewProvider.viewType,
            sidebarProvider
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'aiGitAssistant.refreshOverview',
            () => sidebarProvider.refresh()
        ),
        vscode.commands.registerCommand(
            'aiGitAssistant.refreshSidebarViews',
            () => sidebarProvider.refresh()
        ),
        vscode.commands.registerCommand(
            'aiGitAssistant.showPage',
            (page: string) => sidebarProvider.showPage(page)
        )
    );

    // The overview can still show its no-workspace state in an empty window.
    if (!wsPath) {
        return;
    }

    // ========================================
    // 6. Git Repository Service
    // ========================================
    const repositoryService: IGitRepositoryService =
        new GitRepositoryService(executor);

    const checkGitRepositoryCmd = vscode.commands.registerCommand(
        'ai-git-assistant.checkGitRepository',
        async () => {
            try {
                const result =
                    await repositoryService.checkRepository(wsPath);

                if (!result.isGitRepository) {
                    void vscode.window.showWarningMessage(
                        'Current workspace is not a Git repository.'
                    );
                    return;
                }

                void vscode.window.showInformationMessage(
                    `Git repository detected: ${result.repositoryRoot}`
                );

                console.log(
                    'Git repository root:',
                    result.repositoryRoot
                );

            } catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : String(error);

                void vscode.window.showErrorMessage(
                    `Failed to check Git repository: ${message}`
                );
            }
        }
    );

    // ========================================
    // 11. Git Diff Service
    // ========================================
    const diffProvider = new GitDiffContentProvider(diffService);

    // Register Git Diff Content Provider
    const diffContentProviderRegistration =
        vscode.workspace.registerTextDocumentContentProvider(
            GitDiffContentProvider.scheme,
            diffProvider
        );

    // ========================================
    // 12. Open Git Changes Command
    // ========================================
    const openChangesCmd = vscode.commands.registerCommand(
        'aiGitAssistant.openChanges',
        async () => {
            await vscode.commands.executeCommand(
                'workbench.view.extension.aiGitAssistant'
            );
            sidebarProvider.showPage('changes');
        }
    );

    // ========================================
    // 13. Refresh Git Changes Command
    // ========================================
    const refreshCmd = vscode.commands.registerCommand(
        'aiGitAssistant.refreshChanges',
        () => {
            return sidebarProvider.refresh();
        }
    );

    // ========================================
    // 14. Open Git Diff Command
    // ========================================
    const openDiffCmd = vscode.commands.registerCommand(
        'aiGitAssistant.openDiff',
        async (filePath: string) => {

            if (!filePath) {
                void vscode.window.showWarningMessage(
                    'No file path was provided.'
                );
                return;
            }

            try {
                const currentUri = vscode.Uri.file(
                    path.join(wsPath, filePath)
                );

                const headUri = vscode.Uri.parse(
                    `${GitDiffContentProvider.scheme}:${filePath}?HEAD`
                );

                const title = `${filePath} (Working Tree)`;

                await vscode.commands.executeCommand(
                    'vscode.diff',
                    headUri,
                    currentUri,
                    title
                );

            } catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : String(error);

                void vscode.window.showErrorMessage(
                    `Failed to open diff: ${message}`
                );
            }
        }
    );

    // ========================================
    // 15. Register Subscriptions
    // ========================================
    context.subscriptions.push(
        checkGitRepositoryCmd,
        openChangesCmd,
        refreshCmd,
        openDiffCmd,
        diffContentProviderRegistration
    );
    
    // ========================================
    // 16. Refresh the sidebar when workspace files change
    // ========================================
    const refreshSidebar = () => {
        void sidebarProvider.refresh();
    };

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(() => {
            refreshSidebar();
        }),

        vscode.workspace.onDidCreateFiles(() => {
            refreshSidebar();
        }),

        vscode.workspace.onDidDeleteFiles(() => {
            refreshSidebar();
        }),

        vscode.workspace.onDidRenameFiles(() => {
            refreshSidebar();
        })
    );
}

function registerAiCommands(
    context: vscode.ExtensionContext,
    apiKeys: ApiKeyManager,
    ai: AIController | undefined
): void {
    const requireWorkspace = (run: (controller: AIController) => unknown) => () => {
        if (!ai) {
            void vscode.window.showWarningMessage('Mở một workspace Git để dùng tính năng AI.');
            return;
        }
        return run(ai);
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('aiGitAssistant.ai.setApiKey', async () => {
            if (ai) {
                await ai.setApiKey();
            } else if (await apiKeys.promptForApiKey()) {
                void vscode.window.showInformationMessage('Đã lưu Gemini API key.');
            }
        }),
        vscode.commands.registerCommand('aiGitAssistant.ai.clearApiKey', async () => {
            if (ai) {
                await ai.clearApiKey();
            } else {
                await apiKeys.deleteApiKey();
            }
        }),
        vscode.commands.registerCommand('aiGitAssistant.ai.testConnection', requireWorkspace(c => c.testConnection())),
        vscode.commands.registerCommand('aiGitAssistant.ai.selectModel', requireWorkspace(c => c.selectModel())),
        vscode.commands.registerCommand('aiGitAssistant.ai.generateCommitMessage',
            (sourceControl?: { rootUri?: vscode.Uri }) => requireWorkspace(c => c.generateCommitMessageForScm(sourceControl))()),
        vscode.commands.registerCommand('aiGitAssistant.ai.explainChanges', requireWorkspace(c => c.explainChanges('auto'))),
        vscode.commands.registerCommand('aiGitAssistant.ai.explainStagedChanges', requireWorkspace(c => c.explainChanges('staged'))),
        vscode.commands.registerCommand('aiGitAssistant.ai.reviewChanges', requireWorkspace(c => c.reviewChanges('auto'))),
        vscode.commands.registerCommand('aiGitAssistant.ai.summarizeHistory', requireWorkspace(c => c.summarizeHistory())),
        vscode.commands.registerCommand('aiGitAssistant.ai.summarizeBranch', requireWorkspace(c => c.summarizeBranch())),
        vscode.commands.registerCommand('aiGitAssistant.ai.resolveConflict', requireWorkspace(async c => {
            const editor = vscode.window.activeTextEditor;
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!editor || !root) {
                void vscode.window.showWarningMessage('Mở file đang bị conflict trong editor trước.');
                return;
            }
            const relative = path.relative(root, editor.document.uri.fsPath).split(path.sep).join('/');
            await c.suggestConflictResolution(relative);
        })),
        vscode.commands.registerCommand('aiGitAssistant.ai.openChat', async () => {
            await vscode.commands.executeCommand('workbench.view.extension.aiGitAssistant');
            await vscode.commands.executeCommand('aiGitAssistant.showPage', 'aiChat');
        })
    );
}

export function deactivate(): void {
    // VS Code automatically disposes registered subscriptions.
}
