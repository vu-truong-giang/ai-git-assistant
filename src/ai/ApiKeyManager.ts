import * as vscode from 'vscode';

/**
 * Stores the AI API key in VS Code SecretStorage (OS keychain / credential manager),
 * never in settings.json, so it is not synced, committed or logged.
 */
export class ApiKeyManager {
    private static readonly SECRET_KEY = 'aiGitAssistant.gemini.apiKey';

    readonly onDidChange: vscode.Event<void>;
    private cached: string | undefined;
    private loaded = false;

    constructor(private readonly secrets: vscode.SecretStorage) {
        const emitter = new vscode.EventEmitter<void>();
        this.onDidChange = emitter.event;
        secrets.onDidChange(event => {
            if (event.key === ApiKeyManager.SECRET_KEY) {
                this.loaded = false;
                emitter.fire();
            }
        });
    }

    async getApiKey(): Promise<string | undefined> {
        if (!this.loaded) {
            this.cached = await this.secrets.get(ApiKeyManager.SECRET_KEY);
            this.loaded = true;
        }
        return this.cached;
    }

    async hasApiKey(): Promise<boolean> {
        return Boolean(await this.getApiKey());
    }

    async setApiKey(value: string): Promise<void> {
        await this.secrets.store(ApiKeyManager.SECRET_KEY, value.trim());
        this.cached = value.trim();
        this.loaded = true;
    }

    async deleteApiKey(): Promise<void> {
        await this.secrets.delete(ApiKeyManager.SECRET_KEY);
        this.cached = undefined;
        this.loaded = true;
    }

    /** Asks the user for a key; returns true when one was saved. */
    async promptForApiKey(): Promise<boolean> {
        const value = await vscode.window.showInputBox({
            title: 'Gemini API Key',
            prompt: 'Nhập Gemini API key (lấy tại https://aistudio.google.com/apikey). Key được lưu an toàn trong SecretStorage.',
            password: true,
            ignoreFocusOut: true,
            placeHolder: 'AIza...',
            validateInput: input => {
                const trimmed = input.trim();
                if (!trimmed) {
                    return 'API key không được để trống.';
                }
                if (/\s/.test(trimmed)) {
                    return 'API key không được chứa khoảng trắng.';
                }
                return undefined;
            }
        });
        if (!value) {
            return false;
        }
        await this.setApiKey(value);
        return true;
    }
}
