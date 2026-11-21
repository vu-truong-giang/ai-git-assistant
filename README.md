# AI Git Assistant

A VS Code extension that helps with everyday Git work, with AI features powered by Google Gemini.

## Development

```bash
npm install
npm run compile     # type-check + lint + bundle
npm test            # type-check + unit/integration tests (no API key needed)
```

Press `F5` in VS Code to launch the Extension Development Host, then open **AI Git Assistant** in the Activity Bar.

The sidebar has one integrated view with Overview, Changes, Commit, Branches, Conflict, History, Sync, AI Chat and Settings pages.

## AI setup

1. Get a free Gemini API key at <https://aistudio.google.com/apikey>.
2. Sidebar → **Settings** → **Nhập API Key** (or run **AI Git Assistant: Set Gemini API Key**).
   The key is stored in VS Code SecretStorage (OS keychain), never in `settings.json`.
3. Click **Kiểm tra kết nối** (**Test AI Connection**). If the model is not available for your key,
   use **Select AI Model** to pick one from the list your key can use.

The first time an AI feature sends code, the extension asks for consent. Sensitive files (`.env`, `*.pem`, `*.key`, ...)
are never sent, and values that look like secrets (API keys, tokens, passwords, private keys) are masked as `[REDACTED]`.

## AI features

| Feature | Where |
|---|---|
| Generate commit message (Conventional Commits) | Commit page **✦ Generate with AI**; Source Control title bar ✨ button |
| Explain changes | Changes page **Giải thích thay đổi**; Overview **Analyze Changes**; command **AI: Explain Changes** |
| Code review (logic errors, code smells, improvements) | Changes page **Review code**; command **AI: Review Changes** |
| Git chat with repository context | AI Chat page; command **AI: Open Git Chat** |
| Merge conflict assistant (shows a diff before applying) | Conflict page **AI đề xuất cách giải quyết**; command **AI: Suggest Merge Conflict Resolution** (active file) |
| Commit history summary | History page; command **AI: Summarize Commit History** |
| Branch summary vs. a base branch (+ suggested PR) | Branches page; Overview **Analyze Branch** |

Long-running requests show progress and can be cancelled. Errors (invalid key, rate limit, timeout, network, ...)
are shown with a fix action; details go to the **AI Git Assistant** output channel.

## Settings (`aiGitAssistant.ai.*`)

| Setting | Default | |
|---|---|---|
| `enabled` | `true` | Turn AI features on/off |
| `model` | `gemini-flash-latest` | Gemini model id |
| `timeoutSeconds` | `60` | Request timeout |
| `responseLanguage` | `Vietnamese` | Language of explanations, reviews, chat, summaries |
| `commitMessageLanguage` | `English` | Language of commit messages |
| `commitMessageStyle` | `conventional` | `conventional` or `simple` |
| `maxContextChars` | `60000` | Diff budget; large diffs are truncated fairly across files |
| `excludeFiles` | lock files, `*.min.js`, `dist/**`, ... | Files whose diff content is not sent |
| `redactSecrets` | `true` | Mask secret-looking values before sending |

## Architecture

```
src/ai/                      (no VS Code dependency → unit-testable)
  interfaces/IAIProvider.ts  provider contract
  providers/GeminiProvider.ts  Gemini REST API, error mapping, timeout/cancel
  AIService.ts               settings, retries with backoff, logging, connection test
  context/                   Git context builder, diff parsing, size limiter, secret redaction
  prompts/                   one prompt builder per feature
  parsers/                   commit message / review JSON parsing
  features/                  commit message, explain, review, chat, conflict, summaries
src/ui/
  AIController.ts            VS Code glue: API key, consent, progress, errors, commands
  AIResultPanel.ts           editor tab for explanations, reviews and summaries
  markdown.ts                safe Markdown renderer (escapes all AI output)
src/test/unit/               node:test suites, incl. a real temporary git repository
```
