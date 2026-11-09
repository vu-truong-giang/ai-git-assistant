const vscode = acquireVsCodeApi();

document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) {
        return;
    }
    vscode.postMessage({
        command: target.dataset.action,
        file: target.dataset.file,
        line: target.dataset.line
    });
});
