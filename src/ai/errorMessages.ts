import { AIError, AIErrorCode } from './models/AIError.model';

const MESSAGES: Record<AIErrorCode, string> = {
    DISABLED: 'Tính năng AI đang tắt. Bật "aiGitAssistant.ai.enabled" trong Settings.',
    MISSING_API_KEY: 'Chưa có API key. Hãy nhập Gemini API key để dùng tính năng AI.',
    INVALID_API_KEY: 'API key không hợp lệ hoặc không có quyền. Hãy kiểm tra và nhập lại.',
    MODEL_NOT_FOUND: 'Không tìm thấy model AI đã cấu hình. Hãy chọn model khác.',
    RATE_LIMITED: 'Đã vượt giới hạn số request của AI. Đợi một lát rồi thử lại.',
    TIMEOUT: 'AI phản hồi quá lâu nên đã bị ngắt. Thử lại hoặc tăng "aiGitAssistant.ai.timeoutSeconds".',
    CANCELLED: 'Đã hủy yêu cầu AI.',
    NETWORK: 'Không kết nối được tới máy chủ AI. Kiểm tra mạng/proxy rồi thử lại.',
    CONTENT_BLOCKED: 'AI từ chối xử lý nội dung này (bộ lọc an toàn).',
    INVALID_RESPONSE: 'AI trả về kết quả không hợp lệ. Hãy thử lại.',
    PROVIDER_ERROR: 'Máy chủ AI gặp lỗi. Hãy thử lại sau.'
};

/** User-facing (Vietnamese) description of an AI failure. */
export function describeAIError(error: unknown): string {
    if (error instanceof AIError) {
        const base = MESSAGES[error.code];
        // Keep the provider detail for codes where it helps the user act.
        if (error.code === 'PROVIDER_ERROR' || error.code === 'INVALID_RESPONSE' || error.code === 'MODEL_NOT_FOUND') {
            return `${base} (${error.message})`;
        }
        return base;
    }
    return error instanceof Error ? error.message : String(error);
}
