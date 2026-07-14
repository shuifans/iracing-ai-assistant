import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { MessageAttachment } from '@/db/schema/chat';
import type { ChatAnswerBackend } from '@/config/constants';
import { AppError } from '@/lib/errors';

export interface ModelImageAttachment {
  base64: string;
  mediaType: string;
}

/** Product/UI and server-side per-message attachment limits. */
export const MAX_CHAT_ATTACHMENTS = 4;
export const MAX_CHAT_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024;

/** Fail closed when an operator marks the selected direct model as non-vision. */
export function assertAttachmentBackendSupported(
  backend: ChatAnswerBackend,
  hasAttachments: boolean,
): void {
  if (
    hasAttachments &&
    backend === 'llm-direct' &&
    process.env.LLM_IMAGE_INPUT_SUPPORTED === 'false'
  ) {
    throw new AppError('VALIDATION_ERROR', '当前模型后端不支持图片输入，请切换后端或移除附件');
  }
}

/** Load already-authorized attachments from DATA_ROOT/uploads for model input. */
export async function loadAttachmentImages(
  attachments: Array<Pick<MessageAttachment, 'relativePath' | 'mimeType'>>,
): Promise<ModelImageAttachment[]> {
  const uploadRoot = path.resolve(
    process.env.DATA_ROOT ?? path.join(process.cwd(), 'data'),
    'uploads',
  );

  return Promise.all(
    attachments.map(async (attachment) => {
      const absolutePath = path.resolve(uploadRoot, attachment.relativePath);
      const relative = path.relative(uploadRoot, absolutePath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new AppError('VALIDATION_ERROR', '附件路径无效');
      }
      try {
        const data = await readFile(absolutePath);
        return { base64: data.toString('base64'), mediaType: attachment.mimeType };
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('VALIDATION_ERROR', '附件文件不可用，请重新上传');
      }
    }),
  );
}
