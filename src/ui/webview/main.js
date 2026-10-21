const vscode = acquireVsCodeApi();

const elements = {
    repoState: document.getElementById('repoState'),
    repoName: document.getElementById('repoName'),
    repoPath: document.getElementById('repoPath'),
    branchName: document.getElementById('branchName'),
    trackingBranch: document.getElementById('trackingBranch'),
    aheadCount: document.getElementById('aheadCount'),
    behindCount: document.getElementById('behindCount'),
    changeCount: document.getElementById('changeCount'),
    stagedCount: document.getElementById('stagedCount'),
    unstagedCount: document.getElementById('unstagedCount'),
    fileList: document.getElementById('fileList'),
    insightText: document.getElementById('insightText'),
    message: document.getElementById('message')
};

document.getElementById('refreshButton').addEventListener('click', () => {
    vscode.postMessage({ command: 'refresh' });
});

document.getElementById('detailsButton').addEventListener('click', () => {
    vscode.postMessage({ command: 'openChanges' });
});

window.addEventListener('message', event => {
    if (event.data.command === 'update') {
        render(event.data.data);
    }
});

function render(data) {
    elements.message.textContent = data.message ?? '';

    if (!data.hasRepository) {
        elements.repoState.textContent = 'No repository';
        elements.repoName.textContent = data.message ?? 'No workspace';
        elements.repoPath.textContent = '';
        elements.branchName.textContent = '—';
        elements.trackingBranch.textContent = 'Tracking: —';
        elements.aheadCount.textContent = '0';
        elements.behindCount.textContent = '0';
        elements.changeCount.textContent = '0 files';
        elements.stagedCount.textContent = 'Staged: 0';
        elements.unstagedCount.textContent = 'Unstaged: 0';
        elements.fileList.replaceChildren();
        elements.insightText.textContent = data.message ?? '';
        return;
    }

    const files = Array.isArray(data.files) ? data.files : [];
    const staged = files.filter(file => file.staged).length;
    const unstaged = files.length - staged;

    elements.repoState.textContent = 'Git repository';
    elements.repoName.textContent = data.repositoryName;
    elements.repoPath.textContent = data.repositoryPath;
    elements.branchName.textContent = data.branch || 'Detached HEAD';
    elements.trackingBranch.textContent =
        `Tracking: ${data.trackingBranch || '—'}`;
    elements.aheadCount.textContent = String(data.ahead);
    elements.behindCount.textContent = String(data.behind);
    elements.changeCount.textContent =
        `${files.length} ${files.length === 1 ? 'file' : 'files'}`;
    elements.stagedCount.textContent = `Staged: ${staged}`;
    elements.unstagedCount.textContent = `Unstaged: ${unstaged}`;
    elements.insightText.textContent = files.length
        ? `${files.length} changed ${files.length === 1 ? 'file' : 'files'} in this repository.`
        : 'The working tree is clean.';

    elements.fileList.replaceChildren();
    if (files.length === 0) {
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'file-empty';
        emptyMessage.textContent = 'No changed files.';
        elements.fileList.append(emptyMessage);
        return;
    }

    for (const file of files) {
        const button = document.createElement('button');
        button.className = 'file-row';
        button.type = 'button';

        const status = document.createElement('span');
        status.className = `file-status ${statusClass(file.status)}`;
        status.textContent = statusLabel(file.status);

        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = file.filePath;

        button.append(status, name);
        button.addEventListener('click', () => {
            vscode.postMessage({
                command: 'showFile',
                filePath: file.filePath
            });
        });
        elements.fileList.append(button);
    }
}

function statusLabel(status) {
    return ({ modified: 'M', added: 'A', untracked: 'U', deleted: 'D', conflicted: '!' })[status] ?? '?';
}

function statusClass(status) {
    return ({ modified: 'modified', added: 'added', untracked: 'untracked', deleted: 'deleted', conflicted: 'conflicted' })[status] ?? '';
}