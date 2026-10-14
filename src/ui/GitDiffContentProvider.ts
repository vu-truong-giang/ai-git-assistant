import * as vscode from 'vscode';
import { IDiffService } from '../git/interfaces/DiffService.interface';

export class GitDiffContentProvider implements vscode.TextDocumentContentProvider {
    public static readonly scheme = 'aigit-diff';
    
    constructor(private diffService: IDiffService) {}

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const filePath = uri.path;
        const ref = uri.query || 'HEAD';

        return await this.diffService.getFileContent(filePath, ref);
    }
}
