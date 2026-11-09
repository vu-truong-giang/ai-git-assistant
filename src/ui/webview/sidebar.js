const vscode = acquireVsCodeApi();
const content = document.getElementById('content');
const titles = {
    overview: 'Overview',
    changes: 'Changes',
    commit: 'Commit',
    branches: 'Branches',
    conflict: 'Conflict',
    history: 'History',
    sync: 'Sync',
    aiChat: 'AI Chat',
    settings: 'Settings'
};
let page = 'overview';
let repository = {};

// AI state lives here so it survives the full re-render that happens on every refresh.
let ai = { status: {}, busy: [], chat: [] };
let commitDraft = '';
let chatDraft = '';
let pendingQuestion = null;

document.querySelectorAll('.nav-item').forEach(button => {
    button.addEventListener('click', () => {
        page = button.dataset.page;
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item === button);
        });
        render();
    });
});

for (const id of ['refresh', 'pageRefresh', 'workspaceRefresh']) {
    document.getElementById(id).addEventListener('click', () => {
        vscode.postMessage({ command: 'refresh' });
    });
}

window.addEventListener('message', event => {
    const data = event.data;
    switch (data.command) {
        case 'navigate':
            setPage(data.page);
            return;
        case 'update':
            repository = data.data;
            render();
            return;
        case 'aiState':
            ai = data.state;
            render();
            return;
        case 'commitMessage':
            commitDraft = data.message;
            if (page === 'commit') {
                render();
                document.getElementById('commitInput')?.focus();
            }
            return;
        case 'commitDone':
            commitDraft = '';
            return;
        case 'chatSent':
            if (data.ok) {
                chatDraft = '';
            }
            pendingQuestion = null;
            render();
            return;
        default:
            return;
    }
});

content.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) {
        return;
    }
    const action = button.dataset.action;
    if (action === 'aiChatSend') {
        sendChat();
        return;
    }
    if (action === 'clearCommitDraft') {
        commitDraft = '';
        render();
        return;
    }
    vscode.postMessage({
        command: action,
        filePath: button.dataset.file,
        branch: button.dataset.branch,
        remoteName: button.dataset.remoteName,
        remoteBranch: button.dataset.remoteBranch,
        resolution: button.dataset.resolution,
        action: button.dataset.sync,
        scope: button.dataset.scope,
        task: button.dataset.task,
        message: action === 'copyText' ? commitDraft : undefined
    });
});

content.addEventListener('submit', event => {
    event.preventDefault();
    if (event.target.id === 'commitForm') {
        vscode.postMessage({ command: 'commit', message: commitDraft });
    } else if (event.target.id === 'chatForm') {
        sendChat();
    }
});

content.addEventListener('keydown', event => {
    // Enter sends, Shift+Enter inserts a newline.
    if (event.target.id === 'chatInput' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendChat();
    }
});

function sendChat() {
    const question = chatDraft.trim();
    if (!question || isBusy('chat')) {
        return;
    }
    pendingQuestion = question;
    vscode.postMessage({ command: 'aiChatSend', message: question });
    render();
}

function isBusy(task) {
    return (ai.busy ?? []).includes(task);
}

function aiReady() {
    return Boolean(ai.status?.enabled && ai.status?.hasApiKey);
}

function render() {
    // Re-rendering replaces the DOM; keep focus and caret in the field the user is typing in.
    const active = document.activeElement;
    const focusId = active && content.contains(active) ? active.id : '';
    const caret = focusId && typeof active.selectionStart === 'number' ? active.selectionStart : null;

    renderPage();

    if (focusId) {
        const element = document.getElementById(focusId);
        if (element) {
            element.focus();
            if (caret !== null && typeof element.setSelectionRange === 'function') {
                element.setSelectionRange(caret, caret);
            }
        }
    }
    const log = document.getElementById('chatLog');
    if (log) {
        log.scrollTop = log.scrollHeight;
    }
}

function renderPage() {
    document.getElementById('pageTitle').textContent = titles[page];
    if (repository.error) {
        document.getElementById('workspaceName').textContent = 'Workspace';
        content.innerHTML = `<section class="card"><p class="muted">${escapeHtml(repository.error)}</p></section>${page === 'settings' ? renderAiSettingsCard() : ''}`;
        return;
    }

    const files = repository.files ?? [];
    const staged = files.filter(file => file.staged);
    const unstaged = files.filter(file => !file.staged);
    const conflicts = repository.conflicts ?? [];
    document.getElementById('workspaceName').textContent =
        repository.repositoryName || 'Workspace';
    document.getElementById('changeBadge').textContent = String(files.length);
    document.getElementById('conflictBadge').textContent = String(conflicts.length);
    document.getElementById('currentBranch').textContent =
        `⑂ ${repository.branch || '—'}`;
    document.querySelector('.status-bar span:nth-child(2)').textContent =
        `↑ ${repository.ahead ?? 0} ↓ ${repository.behind ?? 0}`;

    const pages = {
        overview: () => renderOverview(files, staged, unstaged, conflicts),
        changes: () => renderChanges(staged, unstaged),
        commit: () => renderCommit(staged),
        branches: () => renderBranches(repository.branches ?? []),
        conflict: () => renderConflicts(conflicts),
        history: () => renderHistory(repository.history ?? []),
        sync: () => renderSync(),
        aiChat: renderAiChat,
        settings: renderSettings
    };
    content.innerHTML = pages[page]();
}

function aiButton(task, action, label, busyLabel, extra = '', className = 'secondary-button') {
    const busy = isBusy(task);
    return `<button class="${className}" type="button" data-action="${action}" ${extra} ${busy ? 'disabled' : ''}>${busy ? `<span class="spinner"></span>${busyLabel}` : label}</button>`;
}

function cancelButton(task) {
    return isBusy(task)
        ? `<button class="text-button" type="button" data-action="aiCancel" data-task="${task}">Hủy</button>`
        : '';
}

function renderOverview(files, staged, unstaged, conflicts) {
    const clean = files.length === 0;
    return `
        <section class="repo-card card">
            <div class="section-heading"><span class="eyebrow">REPOSITORY</span>
                <span class="badge ${clean ? 'success' : 'warning'}">${clean ? '● Clean' : '● Changes'}</span>
            </div>
            <h2>${escapeHtml(repository.repositoryName || 'Repository')}</h2>
            <p class="muted path">${escapeHtml(repository.repositoryPath || '')}</p>
            <div class="divider"></div>
            <span class="eyebrow">CURRENT BRANCH</span>
            <strong class="branch-name">${escapeHtml(repository.branch || 'Detached HEAD')}</strong>
            <p class="muted">Tracking: ${escapeHtml(repository.trackingBranch || '—')}</p>
        </section>
        <div class="stats-grid">
            <section class="stat-card card"><span class="muted">↑ Ahead</span><strong>${repository.ahead ?? 0}</strong><small>commits</small></section>
            <section class="stat-card card"><span class="muted">↓ Behind</span><strong>${repository.behind ?? 0}</strong><small>commits</small></section>
        </div>
        <section class="card">
            <div class="section-heading"><h2>Changes</h2><span class="badge">${files.length} files</span></div>
            <p class="muted summary">Staged: ${staged.length} · Unstaged: ${unstaged.length}</p>
            ${files.length ? files.slice(0, 5).map(fileRow).join('') : '<p class="muted">Working tree is clean.</p>'}
            ${files.length > 5 ? `<button class="text-button" data-page-link="changes">View all ${files.length} changes</button>` : ''}
        </section>
        <section class="insight-card card">
            <div class="section-heading"><h2>AI Insights</h2><span class="badge ${aiReady() ? 'success' : 'warning'}">${aiReady() ? 'AI ready' : 'AI chưa cấu hình'}</span></div>
            <p class="insight-line">${clean ? '✓ Working tree is clean.' : `● ${files.length} file(s) have changes.`}</p>
            <p class="insight-line">↑ ${repository.ahead ?? 0} commit(s) ahead of upstream.</p>
            <p class="insight-line">${conflicts.length ? `⚠ ${conflicts.length} merge conflict(s) need attention.` : '✓ No merge conflicts.'}</p>
            ${aiReady() ? '' : '<button class="text-button" data-page-link="settings">Cấu hình AI →</button>'}
        </section>
        <section class="card quick-actions">
            <h2>Quick Actions</h2>
            <div class="quick-grid">
                ${aiButton('explain', 'aiExplainChanges', '▤ Analyze Changes', 'Analyzing...', 'data-scope="auto"', '')}
                <button data-page-link="commit">✦ Generate Commit</button>
                ${aiButton('branchSummary', 'aiSummarizeBranch', '⑂ Analyze Branch', 'Analyzing...', '', '')}
                <button data-page-link="sync">⇅ Sync Repository</button>
            </div>
        </section>`;
}

function renderChanges(staged, unstaged) {
    const hasChanges = staged.length + unstaged.length > 0;
    return `<section class="card">
        <div class="section-heading"><h2>Changes</h2><button class="icon-button" data-action="refresh">⟳</button></div>
        <p class="muted summary">${unstaged.length} unstaged · ${staged.length} staged</p>
        <input class="filter-input" id="fileFilter" placeholder="⌕ Filter files..." />
        <div class="tabs"><button class="tab active" data-tab="unstaged">Unstaged (${unstaged.length})</button><button class="tab" data-tab="staged">Staged (${staged.length})</button></div>
        <div id="changeList">${unstaged.map(file => fileRow(file, true)).join('') || '<p class="muted">No unstaged changes.</p>'}</div>
    </section>
    <section class="card">
        <div class="section-heading"><h2>AI Analysis</h2><span class="badge info">Gemini</span></div>
        <p class="muted">${hasChanges ? 'Phân tích tất cả thay đổi chưa commit (hoặc chỉ phần đã stage).' : 'Chưa có thay đổi nào để phân tích.'}</p>
        <div class="ai-actions">
            ${aiButton('explain', 'aiExplainChanges', '✦ Giải thích thay đổi', 'Đang phân tích...', `data-scope="all" ${hasChanges ? '' : 'disabled'}`)}
            ${aiButton('review', 'aiReviewChanges', '⚑ Review code', 'Đang review...', `data-scope="all" ${hasChanges ? '' : 'disabled'}`)}
            ${aiButton('explain', 'aiExplainChanges', 'Giải thích phần đã stage', 'Đang phân tích...', `data-scope="staged" ${staged.length ? '' : 'disabled'}`, 'text-button')}
            ${aiButton('review', 'aiReviewChanges', 'Review phần đã stage', 'Đang review...', `data-scope="staged" ${staged.length ? '' : 'disabled'}`, 'text-button')}
        </div>
        ${cancelButton('explain')}${cancelButton('review')}
    </section>`;
}

function renderCommit(staged) {
    const busy = isBusy('commit');
    return `<section class="card">
        <div class="section-heading"><h2>Generate Commit Message</h2><span class="badge">${staged.length} files changed</span></div>
        <p class="muted summary">+${staged.length} staged · Review the staged files before committing.</p>
        <form id="commitForm">
            <label class="field-label" for="commitInput">Commit message</label>
            <textarea id="commitInput" name="message" rows="6" placeholder="Describe your changes..." required maxlength="5000" ${busy ? 'readonly' : ''}>${escapeHtml(commitDraft)}</textarea>
            ${aiButton('commit', 'generateCommitMessage', commitDraft ? '↻ Tạo lại với AI' : '✦ Generate with AI', 'AI đang viết...', staged.length ? '' : 'disabled', 'secondary-button wide')}
            ${cancelButton('commit')}
            <div class="inline-actions">
                <button class="secondary-button" type="button" data-action="copyText" ${commitDraft.trim() ? '' : 'disabled'}>⧉ Copy</button>
                <button class="secondary-button" type="button" data-action="clearCommitDraft" ${commitDraft ? '' : 'disabled'}>✕ Xóa</button>
            </div>
            <button class="primary-button wide" type="submit" ${staged.length && commitDraft.trim() && !busy ? '' : 'disabled'}>✓ Commit staged changes</button>
        </form>
        <p class="muted">${staged.length ? `${staged.length} staged file(s) will be committed. Bạn có thể sửa message trước khi commit.` : 'Stage changes before committing.'}</p>
    </section>
    <section class="card"><h2>Staged files</h2>${staged.map(file => fileRow(file, false, true)).join('') || '<p class="muted">No staged files.</p>'}</section>`;
}

function renderBranches(branches) {
    return `<section class="card">
        <div class="section-heading"><h2>Branches</h2><button class="icon-button" data-action="refresh">⟳</button></div>
        <button class="primary-button wide create-branch" data-action="createBranch">＋ Create branch</button>
        <label class="field-label" for="branchFilter">Local and remote branches</label>
        <input class="filter-input" id="branchFilter" placeholder="⌕ Search branches..." />
        <div class="branch-list">${branches.map(branch => `<div class="branch-row"><div class="branch-name-wrap"><strong>${branch.current ? '● ' : '⑂ '}${escapeHtml(branch.name)}</strong><small>${escapeHtml(branch.tracking || (branch.isRemote ? 'Remote branch' : 'Local branch'))}</small></div><div class="branch-actions">${branch.current ? '<span class="badge success">Current</span>' : `<button class="secondary-button" data-action="switchBranch" data-branch="${escapeAttr(branch.name)}">Checkout</button><button class="text-button" data-action="mergeBranch" data-branch="${escapeAttr(branch.name)}">Merge</button>`}${branch.isRemote ? (branch.remoteName && branch.remoteBranch ? `<button class="text-button" data-action="deleteRemoteBranch" data-remote-name="${escapeAttr(branch.remoteName)}" data-remote-branch="${escapeAttr(branch.remoteBranch)}">Delete remote</button>` : '') : `<button class="text-button" data-action="renameBranch" data-branch="${escapeAttr(branch.name)}">Rename</button><button class="text-button" data-action="deleteBranch" data-branch="${escapeAttr(branch.name)}">Delete</button>`}</div></div>`).join('') || '<p class="muted">No branches found.</p>'}</div>
    </section>
    <section class="card"><h2>Branch status</h2><p class="muted">${repository.ahead ?? 0} ahead · ${repository.behind ?? 0} behind ${escapeHtml(repository.trackingBranch || 'upstream')}</p><button class="secondary-button wide" data-page-link="sync">Sync with remote</button></section>
    <section class="card"><h2>AI Branch Summary</h2><p class="muted">So sánh branch hiện tại với một branch gốc (main, develop...) và tóm tắt mục đích, rủi ro, gợi ý Pull Request.</p>
        ${aiButton('branchSummary', 'aiSummarizeBranch', '✦ Tóm tắt branch', 'Đang tóm tắt...', '', 'secondary-button wide')}${cancelButton('branchSummary')}
    </section>`;
}

function renderConflicts(conflicts) {
    if (!conflicts.length) {
        return `<section class="card empty-state"><span class="empty-icon">✓</span><h2>No merge conflicts</h2><p class="muted">Your working tree has no unresolved merge conflicts.</p>${repository.mergeInProgress ? '<button class="primary-button wide" data-action="continueMerge">Continue merge</button>' : ''}</section>`;
    }
    const busy = isBusy('conflict');
    return `${conflicts.map(conflict => `<section class="card conflict-card">
        <div class="section-heading"><h2>Merge conflict</h2><span class="badge danger">Unresolved</span></div>
        <button class="file-link" data-action="openFile" data-file="${escapeAttr(conflict.filePath)}">${escapeHtml(conflict.filePath)}</button>
        <p class="muted">Choose a resolution or open the file to edit manually.</p>
        <button class="secondary-button wide ai-suggest" data-action="aiResolveConflict" data-file="${escapeAttr(conflict.filePath)}" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span>AI đang phân tích...' : '✦ AI đề xuất cách giải quyết'}</button>
        <div class="quick-grid"><button class="secondary-button" data-action="resolveConflict" data-resolution="ours" data-file="${escapeAttr(conflict.filePath)}">Accept Current</button><button class="secondary-button" data-action="resolveConflict" data-resolution="theirs" data-file="${escapeAttr(conflict.filePath)}">Accept Incoming</button><button class="secondary-button" data-action="resolveConflict" data-resolution="both" data-file="${escapeAttr(conflict.filePath)}">Accept Both</button><button class="secondary-button" data-action="markConflictResolved" data-file="${escapeAttr(conflict.filePath)}">Mark resolved</button></div>
        <button class="text-button" data-action="openFile" data-file="${escapeAttr(conflict.filePath)}">Open file</button>
    </section>`).join('')}${cancelButton('conflict')}${repository.mergeInProgress ? '<section class="card"><h2>Ready to finish?</h2><p class="muted">Resolve and stage all conflicted files before continuing the merge.</p><button class="primary-button wide" data-action="continueMerge">Continue merge</button></section>' : ''}`;
}

function renderHistory(history) {
    return `<section class="card"><h2>AI History Summary</h2><p class="muted">Tóm tắt các chủ đề chính, mốc thời gian và người đóng góp từ lịch sử commit.</p>
        ${aiButton('historySummary', 'aiSummarizeHistory', '✦ Tóm tắt lịch sử', 'Đang tóm tắt...', history.length ? '' : 'disabled', 'secondary-button wide')}${cancelButton('historySummary')}
    </section>
    <section class="card"><div class="section-heading"><h2>Commit History</h2><button class="icon-button" data-action="refresh">⟳</button></div>
        ${history.map(commit => `<article class="history-item"><span class="commit-dot">●</span><div><strong>${escapeHtml(commit.message)}</strong><p class="muted">${escapeHtml(commit.hash)} · ${escapeHtml(commit.author)}<br>${escapeHtml(formatDate(commit.date))}</p></div></article>`).join('') || '<p class="muted">No commits yet.</p>'}
    </section>`;
}

function renderSync() {
    const remotes = repository.remotes ?? [];
    return `<section class="card"><div class="section-heading"><h2>Sync Repository</h2><span class="badge info">${escapeHtml(repository.branch || 'Branch')}</span></div>
        <p class="muted">Tracking: ${escapeHtml(repository.trackingBranch || 'No upstream configured')}</p>
        <div class="stats-grid compact"><div class="stat-card card"><span class="muted">↑ Ahead</span><strong>${repository.ahead ?? 0}</strong></div><div class="stat-card card"><span class="muted">↓ Behind</span><strong>${repository.behind ?? 0}</strong></div></div>
        <div class="sync-actions"><button class="secondary-button" data-action="sync" data-sync="fetch">⟳ Fetch</button><button class="secondary-button" data-action="sync" data-sync="pull">↓ Pull</button><button class="primary-button" data-action="sync" data-sync="push">↑ Push</button></div>
    </section>
    <section class="card"><h2>Remotes</h2>${remotes.map(remote => `<p class="remote-row"><strong>${escapeHtml(remote.name)}</strong><span class="muted">${escapeHtml(remote.fetchUrl || 'No fetch URL')}</span></p>`).join('') || '<p class="muted">No remotes configured.</p>'}</section>`;
}

function renderAiChat() {
    const contextCard = `<section class="card chat-context"><span class="eyebrow">REPOSITORY CONTEXT</span><p><strong>${escapeHtml(repository.repositoryName || 'Workspace')}</strong></p><p class="muted">Branch: ${escapeHtml(repository.branch || '—')} · ${(repository.files ?? []).length} changed file(s)</p></section>`;

    if (!aiReady()) {
        return `${contextCard}<section class="card chat-empty"><span class="empty-icon">✦</span><h2>AI Git Assistant</h2><p class="muted">${ai.status?.enabled === false ? 'Tính năng AI đang tắt trong Settings.' : 'Nhập Gemini API key để bắt đầu hỏi đáp về repository.'}</p>
            ${ai.status?.enabled === false ? '<button class="primary-button wide" data-action="openAiSettings">Mở Settings</button>' : '<button class="primary-button wide" data-action="aiSetApiKey">🔑 Nhập API Key</button>'}</section>`;
    }

    const busy = isBusy('chat');
    const messages = (ai.chat ?? []).map(message =>
        `<div class="chat-msg ${message.role}"><div class="chat-bubble">${message.html}</div></div>`).join('');
    const pending = pendingQuestion
        ? `<div class="chat-msg user"><div class="chat-bubble">${escapeHtml(pendingQuestion).replace(/\n/g, '<br>')}</div></div>`
        : '';
    const typing = busy ? '<div class="chat-msg assistant"><div class="chat-bubble typing"><span></span><span></span><span></span></div></div>' : '';
    const empty = !messages && !pending
        ? `<div class="chat-suggestions"><p class="muted">Gợi ý câu hỏi:</p>${['Tôi đã thay đổi những gì?', 'Nên commit các thay đổi này như thế nào?', 'Làm sao hoàn tác commit gần nhất an toàn?', 'Branch hiện tại khác gì so với remote?']
            .map(text => `<button class="text-button suggestion" type="button" data-suggest="${escapeAttr(text)}">${escapeHtml(text)}</button>`).join('')}</div>`
        : '';

    return `${contextCard}
        <section class="card chat-card">
            <div class="section-heading"><h2>AI Git Chat</h2>${(ai.chat ?? []).length ? '<button class="text-button" data-action="aiChatClear">Xóa hội thoại</button>' : ''}</div>
            <div id="chatLog" class="chat-log">${messages}${pending}${typing}${empty}</div>
            <form id="chatForm" class="chat-form">
                <textarea id="chatInput" rows="3" placeholder="Hỏi về repository... (Enter để gửi, Shift+Enter xuống dòng)" maxlength="4000">${escapeHtml(chatDraft)}</textarea>
                <div class="inline-actions">
                    <button class="primary-button" type="submit" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span>Đang trả lời...' : '➤ Gửi'}</button>
                    ${cancelButton('chat')}
                </div>
            </form>
        </section>`;
}

function renderAiSettingsCard() {
    const status = ai.status ?? {};
    const row = (label, value, ok) => `<div class="ai-status-row"><span class="muted">${label}</span><span class="${ok === undefined ? '' : ok ? 'ok' : 'bad'}">${escapeHtml(value)}</span></div>`;
    return `<section class="card">
        <div class="section-heading"><h2>AI Provider</h2><span class="badge ${aiReady() ? 'success' : 'warning'}">${aiReady() ? 'Ready' : 'Chưa sẵn sàng'}</span></div>
        ${row('Provider', status.provider || 'Google Gemini')}
        ${row('Model', status.model || '—')}
        ${row('API key', status.hasApiKey ? '✓ Đã lưu (SecretStorage)' : '✗ Chưa có', Boolean(status.hasApiKey))}
        ${row('AI', status.enabled === false ? 'Đang tắt' : 'Đang bật', status.enabled !== false)}
        <div class="ai-actions">
            <button class="primary-button" data-action="aiSetApiKey">🔑 ${status.hasApiKey ? 'Đổi API Key' : 'Nhập API Key'}</button>
            ${aiButton('test', 'aiTestConnection', '⚡ Kiểm tra kết nối', 'Đang kiểm tra...', status.hasApiKey ? '' : 'disabled')}
            ${aiButton('models', 'aiSelectModel', '◎ Chọn model', 'Đang tải...', status.hasApiKey ? '' : 'disabled')}
            ${status.hasApiKey ? '<button class="secondary-button" data-action="aiClearApiKey">✕ Xóa API Key</button>' : ''}
        </div>
        <p class="muted">Lấy key miễn phí tại aistudio.google.com/apikey. Key không bao giờ được ghi vào settings.json.</p>
    </section>`;
}

function renderSettings() {
    return `${renderAiSettingsCard()}
        <section class="card"><h2>AI Git Assistant Settings</h2><p class="muted">Ngôn ngữ trả lời, kiểu commit message, giới hạn context, file bị loại trừ...</p><button class="secondary-button wide" data-action="openAiSettings">Open extension settings</button></section>
        <section class="card"><h2>Workspace</h2><p><strong>${escapeHtml(repository.repositoryName || 'Workspace')}</strong></p><p class="muted path">${escapeHtml(repository.repositoryPath || '')}</p></section>`;
}

function fileRow(file, canStage = false, staged = false) {
    const statusClass = escapeAttr(file.status);
    const action = staged ? 'unstage' : 'stage';
    const label = staged ? '−' : '+';
    return `<div class="file-row" data-filter-text="${escapeAttr(file.filePath.toLowerCase())}">
        <span class="file-status ${statusClass}">${statusLabel(file.status)}</span>
        <button class="file-link" data-action="openFile" data-file="${escapeAttr(file.filePath)}">${escapeHtml(file.filePath)}</button>
        ${canStage ? `<button class="file-action" title="Stage file" data-action="${action}" data-file="${escapeAttr(file.filePath)}">${label}</button>` : ''}
        ${staged ? `<button class="file-action" title="Unstage file" data-action="${action}" data-file="${escapeAttr(file.filePath)}">${label}</button>` : ''}
    </div>`;
}

function statusLabel(status) {
    return ({ modified: 'M', added: 'A', untracked: 'U', deleted: 'D', conflicted: '!' })[status] ?? '?';
}

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function escapeAttr(value) {
    return escapeHtml(value);
}

content.addEventListener('click', event => {
    const pageLink = event.target.closest('[data-page-link]');
    if (pageLink) {
        setPage(pageLink.dataset.pageLink);
        return;
    }
    const suggestion = event.target.closest('[data-suggest]');
    if (suggestion) {
        chatDraft = suggestion.dataset.suggest;
        sendChat();
    }
});

function setPage(targetPage) {
    if (!titles[targetPage]) {
        return;
    }
    page = targetPage;
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });
    render();
}

content.addEventListener('input', event => {
    if (event.target.id === 'commitInput') {
        const hadText = Boolean(commitDraft.trim());
        commitDraft = event.target.value;
        // Enable/disable the commit-related buttons without a full re-render.
        if (hadText !== Boolean(commitDraft.trim())) {
            const form = event.target.closest('form');
            const stagedCount = (repository.files ?? []).filter(file => file.staged).length;
            form.querySelector('[type="submit"]').disabled = !commitDraft.trim() || !stagedCount;
            form.querySelector('[data-action="copyText"]').disabled = !commitDraft.trim();
            form.querySelector('[data-action="clearCommitDraft"]').disabled = !commitDraft;
        }
    }
    if (event.target.id === 'chatInput') {
        chatDraft = event.target.value;
    }
    if (event.target.id === 'fileFilter') {
        const query = event.target.value.toLowerCase();
        content.querySelectorAll('.file-row').forEach(row => {
            row.hidden = !row.dataset.filterText.includes(query);
        });
    }
    if (event.target.id === 'branchFilter') {
        const query = event.target.value.toLowerCase();
        content.querySelectorAll('.branch-row').forEach(row => {
            row.hidden = !row.textContent.toLowerCase().includes(query);
        });
    }
});

content.addEventListener('click', event => {
    const tab = event.target.closest('[data-tab]');
    if (!tab) {
        return;
    }
    content.querySelectorAll('.tab').forEach(item => {
        item.classList.toggle('active', item === tab);
    });
    const files = tab.dataset.tab === 'staged'
        ? (repository.files ?? []).filter(file => file.staged)
        : (repository.files ?? []).filter(file => !file.staged);
    const list = document.getElementById('changeList');
    list.innerHTML = files.map(file => fileRow(file, !file.staged, file.staged)).join('') ||
        '<p class="muted">No changes found.</p>';
});

// Ask the extension for the AI state once the script is ready.
vscode.postMessage({ command: 'aiReady' });
