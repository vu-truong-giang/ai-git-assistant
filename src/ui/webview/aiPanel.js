/* global Element */

const vscode = acquireVsCodeApi();

let pendingHtml = null;
let renderScheduled = false;
let renderVersion = 0;

// Xử lý các thao tác từ người dùng: Copy, mở file...
document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) {
        return;
    }

    const target = event.target.closest('[data-action]');

    if (!target || target.disabled) {
        return;
    }

    vscode.postMessage({
        command: target.dataset.action,
        file: target.dataset.file,
        line: target.dataset.line
    });
});

// Cập nhật nội dung Markdown.
function renderMarkdown(html) {
    const article = document.querySelector('.markdown');

    if (!article || typeof html !== 'string') {
        return;
    }

    article.innerHTML = html;
}

// Gom nhiều lần cập nhật thành một lần render mỗi frame.
function scheduleMarkdownRender(html) {
    pendingHtml = html;

    if (renderScheduled) {
        return;
    }

    renderScheduled = true;
    const currentVersion = renderVersion;

    requestAnimationFrame(() => {
        // Bỏ qua callback cũ nếu trạng thái Streaming đã thay đổi.
        if (currentVersion !== renderVersion) {
            return;
        }

        renderScheduled = false;

        if (pendingHtml !== null) {
            renderMarkdown(pendingHtml);
            pendingHtml = null;
        }
    });
}

// Bật nút Copy khi có nội dung.
function enableCopyButton() {
    const copyButton = document.querySelector('[data-action="copy"]');

    if (copyButton) {
        copyButton.disabled = false;
    }
}

// Vô hiệu hóa nút Copy.
function disableCopyButton() {
    const copyButton = document.querySelector('[data-action="copy"]');

    if (copyButton) {
        copyButton.disabled = true;
    }
}

// Nhận dữ liệu cập nhật từ Extension Host.
window.addEventListener('message', event => {
    const message = event.data;

    if (!message || typeof message.command !== 'string') {
        return;
    }

    // Nhận nội dung Markdown Streaming.
    if (message.command === 'streamUpdate') {
        if (typeof message.html !== 'string') {
            return;
        }

        scheduleMarkdownRender(message.html);
        enableCopyButton();
        return;
    }

    // Khi Streaming hoàn thành.
    if (message.command === 'streamComplete') {
        if (typeof message.html !== 'string') {
            return;
        }

        // Hủy các lần render đang chờ.
        renderVersion++;
        pendingHtml = null;
        renderScheduled = false;

        renderMarkdown(message.html);
        enableCopyButton();
        return;
    }

    // Khi Streaming gặp lỗi hoặc bị hủy.
    if (message.command === 'streamError') {
        renderVersion++;
        pendingHtml = null;
        renderScheduled = false;

        const article = document.querySelector('.markdown');

        if (article) {
            const errorElement = document.createElement('div');
            errorElement.className = 'error-box';
            errorElement.textContent =
                typeof message.message === 'string'
                    ? message.message
                    : 'AI không thể hoàn thành yêu cầu.';

            article.replaceChildren(errorElement);
        }

        disableCopyButton();
    }
});