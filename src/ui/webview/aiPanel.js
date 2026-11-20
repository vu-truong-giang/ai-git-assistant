
const vscode = acquireVsCodeApi();

// Xử lý các thao tác từ người dùng: Copy, mở file...
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

// Nhận dữ liệu cập nhật từ Extension Host.
window.addEventListener('message', event => {
    const message = event.data;

    if (!message || typeof message.command !== 'string') {
        return;
    }

    // Cập nhật nội dung Markdown khi Gemini gửi chunk mới.
    if (message.command === 'streamUpdate') {
        const article = document.querySelector('.markdown');

        if (article && typeof message.html === 'string') {
            article.innerHTML = message.html;
        }
        const copyButton = document.querySelector('[data-action="copy"]');

        if (copyButton) {
            copyButton.disabled = false;
        }
    }

    // Cập nhật trạng thái hoàn thành.
    if (message.command === 'streamComplete') {
        const article = document.querySelector('.markdown');

        if (article && typeof message.html === 'string') {
            article.innerHTML = message.html;
        }
    }
});
