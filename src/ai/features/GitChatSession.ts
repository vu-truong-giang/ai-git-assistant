import { AIMessage } from '../models/AIRequest.model';
import { buildChatMessages, buildChatSystemPrompt } from '../prompts/chatPrompt';
import { AIFeatureDeps, contextRequest } from './AIFeatureContext';

export interface ChatTurn {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

/** Keeps the last N messages so long chats do not blow the context window. */
const MAX_HISTORY_MESSAGES = 20;
const MAX_QUESTION_CHARS = 4000;

/** EPIC 12: conversation with fresh git context injected on every question. */
export class GitChatSession {
    private turns: ChatTurn[] = [];

    constructor(
        private readonly deps: AIFeatureDeps,
        initial: ChatTurn[] = []
    ) {
        this.turns = initial.slice(-MAX_HISTORY_MESSAGES);
    }

    get history(): readonly ChatTurn[] {
        return this.turns;
    }

    clear(): void {
        this.turns = [];
    }

    async ask(question: string, signal?: AbortSignal): Promise<ChatTurn> {
        const text = question.trim().slice(0, MAX_QUESTION_CHARS);
        if (!text) {
            throw new Error('Câu hỏi trống.');
        }
        const preferences = this.deps.getPreferences();
        // Half the budget: the conversation history also needs room.
        const context = await this.deps.contextBuilder.build(contextRequest(
            { ...preferences, maxContextChars: Math.floor(preferences.maxContextChars / 2) },
            'all',
            { historyLimit: 15 }
        ));

        const history: AIMessage[] = this.turns.map(turn => ({ role: turn.role, content: turn.content }));
        const response = await this.deps.ai.generate(
            buildChatMessages(buildChatSystemPrompt(context, preferences.responseLanguage), history, text),
            { temperature: 0.4, signal }
        );

        // Only record the exchange once it succeeded, so a failed request can simply be retried.
        const now = Date.now();
        const answer: ChatTurn = { role: 'assistant', content: response.text.trim(), timestamp: now };
        this.turns.push({ role: 'user', content: text, timestamp: now }, answer);
        this.turns = this.turns.slice(-MAX_HISTORY_MESSAGES);
        return answer;
    }
}
