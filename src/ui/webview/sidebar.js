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
    if (event.data.command === 'navigate') {
        setPage(event.data.page);
        return;
    }
    if (event.data.command !== 'update') {
        return;
    }
    repository = event.data.data;
    render();
});

content.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) {
        return;
    }
    vscode.postMessage({
        command: button.dataset.action,
        filePath: button.dataset.file,
        branch: button.dataset.branch,
        resolution: button.dataset.resolution,
        action: button.dataset.sync
    });
});

content.addEventListener('submit', event => {
    if (event.target.id !== 'commitForm') {
        return;
    }
    event.preventDefault();
    const message = event.target.elements.namedItem('message').value;
    vscode.postMessage({ command: 'commit', message });
});

function render() {
    document.getElementById('pageTitle').textContent = titles[page];
    if (repository.error) {
        document.getElementById('workspaceName').textContent = 'Workspace';
        content.innerHTML = `<section class="card"><p class="muted">${escapeHtml(repository.error)}</p></section>`;
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
            <div class="section-heading"><h2>AI Insights</h2><span class="badge info">Overview</span></div>
            <p class="insight-line">${clean ? '✓ Working tree is clean.' : `● ${files.length} file(s) have changes.`}</p>
            <p class="insight-line">↑ ${repository.ahead ?? 0} commit(s) ahead of upstream.</p>
            <p class="insight-line">${conflicts.length ? `⚠ ${conflicts.length} merge conflict(s) need attention.` : '✓ No merge conflicts.'}</p>
        </section>
        <section class="card quick-actions">
            <h2>Quick Actions</h2>
            <div class="quick-grid">
                <button data-page-link="changes">▤ Analyze Changes</button>
                <button data-page-link="commit">✦ Generate Commit</button>
                <button data-page-link="branches">⑂ Analyze Branch</button>
                <button data-page-link="sync">⇅ Sync Repository</button>
            </div>
        </section>`;
}

function renderChanges(staged, unstaged) {
    return `<section class="card">
        <div class="section-heading"><h2>Changes</h2><button class="icon-button" data-action="refresh">⟳</button></div>
        <p class="muted summary">${unstaged.length} unstaged · ${staged.length} staged</p>
        <input class="filter-input" id="fileFilter" placeholder="⌕ Filter files..." />
        <div class="tabs"><button class="tab active" data-tab="unstaged">Unstaged (${unstaged.length})</button><button class="tab" data-tab="staged">Staged (${staged.length})</button></div>
        <div id="changeList">${unstaged.map(file => fileRow(file, true)).join('') || '<p class="muted">No unstaged changes.</p>'}</div>
    </section>
    <section class="card"><h2>AI Analysis</h2><p class="muted">AI analysis is unavailable until an AI provider is configured.</p><button class="secondary-button" data-page-link="aiChat">Open AI Chat</button></section>`;
}

function renderCommit(staged) {
    return `<section class="card">
        <div class="section-heading"><h2>Generate Commit Message</h2><span class="badge">${staged.length} files changed</span></div>
        <p class="muted summary">+${staged.length} staged · Review the staged files before committing.</p>
        <form id="commitForm">
            <label class="field-label" for="commitInput">Commit message</label>
            <textarea id="commitInput" name="message" rows="4" placeholder="Describe your changes..." required maxlength="500"></textarea>
            <button class="secondary-button wide" type="button" data-action="generateCommitMessage">✦ Generate with AI</button>
            <button class="primary-button wide" type="submit" ${staged.length ? '' : 'disabled'}>✓ Commit staged changes</button>
        </form>
        <p class="muted">${staged.length ? `${staged.length} staged file(s) will be committed.` : 'Stage changes before committing.'}</p>
    </section>
    <section class="card"><h2>Staged files</h2>${staged.map(file => fileRow(file, false, true)).join('') || '<p class="muted">No staged files.</p>'}</section>`;
}

function renderBranches(branches) {
    return `<section class="card">
        <div class="section-heading"><h2>Branches</h2><button class="icon-button" data-action="refresh">⟳</button></div>
        <button class="primary-button wide create-branch" data-action="createBranch">＋ Create branch</button>
        <label class="field-label" for="branchFilter">Local and remote branches</label>
        <input class="filter-input" id="branchFilter" placeholder="⌕ Search branches..." />
        <div class="branch-list">${branches.map(branch => `<div class="branch-row"><div class="branch-name-wrap"><strong>${branch.current ? '● ' : '⑂ '}${escapeHtml(branch.name)}</strong><small>${escapeHtml(branch.tracking || '')}</small></div>${branch.current ? '<span class="badge success">Current</span>' : `<button class="secondary-button" data-action="switchBranch" data-branch="${escapeAttr(branch.name)}">Checkout</button>`}</div>`).join('') || '<p class="muted">No branches found.</p>'}</div>
    </section>
    <section class="card"><h2>Branch status</h2><p class="muted">${repository.ahead ?? 0} ahead · ${repository.behind ?? 0} behind ${escapeHtml(repository.trackingBranch || 'upstream')}</p><button class="secondary-button wide" data-page-link="sync">Sync with remote</button></section>`;
}

function renderConflicts(conflicts) {
    if (!conflicts.length) {
        return `<section class="card empty-state"><span class="empty-icon">✓</span><h2>No merge conflicts</h2><p class="muted">Your working tree has no unresolved merge conflicts.</p></section>`;
    }
    return conflicts.map(conflict => `<section class="card conflict-card">
        <div class="section-heading"><h2>Merge conflict</h2><span class="badge danger">Unresolved</span></div>
        <button class="file-link" data-action="openFile" data-file="${escapeAttr(conflict.filePath)}">${escapeHtml(conflict.filePath)}</button>
        <p class="muted">Choose a resolution or open the file to edit manually.</p>
        <div class="quick-grid"><button class="secondary-button" data-action="resolveConflict" data-resolution="ours" data-file="${escapeAttr(conflict.filePath)}">Accept Current</button><button class="secondary-button" data-action="resolveConflict" data-resolution="theirs" data-file="${escapeAttr(conflict.filePath)}">Accept Incoming</button></div>
        <button class="text-button" data-action="openFile" data-file="${escapeAttr(conflict.filePath)}">Open file</button>
    </section>`).join('');
}

function renderHistory(history) {
    return `<section class="card"><div class="section-heading"><h2>Commit History</h2><button class="icon-button" data-action="refresh">⟳</button></div>
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
    return `<section class="card chat-context"><span class="eyebrow">REPOSITORY CONTEXT</span><p><strong>${escapeHtml(repository.repositoryName || 'Workspace')}</strong></p><p class="muted">Branch: ${escapeHtml(repository.branch || '—')}</p><p class="muted">${(repository.files ?? []).length} changed file(s)</p></section>
        <section class="card chat-empty"><span class="empty-icon">✦</span><h2>AI Git Assistant</h2><p class="muted">The chat interface is ready, but no AI provider is connected. Configure an AI provider to enable repository questions and suggestions.</p><button class="primary-button wide" data-action="openAiSettings">Open AI settings</button></section>`;
}

function renderSettings() {
    return `<section class="card"><h2>AI Git Assistant Settings</h2><p class="muted">Configure AI options and extension behavior in VS Code Settings.</p><button class="primary-button wide" data-action="openAiSettings">Open extension settings</button></section>
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
    if (!pageLink) {
        return;
    }
    setPage(pageLink.dataset.pageLink);
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
