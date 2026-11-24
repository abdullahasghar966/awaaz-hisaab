import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const TRANSCRIPT_PREFIX = 'TRANSCRIPT:';

// Mock speech-to-text for dev and tests. Resolution order:
// 1. explicit mockTranscript, 2. sidecar .txt next to sourcePath, 3. buffer that is UTF-8 "TRANSCRIPT:<text>".
export function createMockStt() {
  return {
    name: 'mock',
    async transcribe({ buffer = null, sourcePath = null, mockTranscript = null } = {}) {
      if (mockTranscript) {
        return { text: String(mockTranscript).trim(), language: null, provider: 'mock' };
      }

      if (sourcePath) {
        const sidecar = sourcePath.slice(0, sourcePath.length - extname(sourcePath).length) + '.txt';
        let content = null;
        try {
          content = await readFile(sidecar, 'utf8');
        } catch {
          content = null; // no sidecar; fall through to the buffer check
        }
        if (content !== null) {
          return { text: content.trim(), language: null, provider: 'mock' };
        }
      }

      if (buffer && buffer.length >= TRANSCRIPT_PREFIX.length) {
        try {
          const decoded = UTF8.decode(buffer);
          if (decoded.startsWith(TRANSCRIPT_PREFIX)) {
            return { text: decoded.slice(TRANSCRIPT_PREFIX.length).trim(), language: null, provider: 'mock' };
          }
        } catch {
          // not valid UTF-8, so it cannot carry a transcript
        }
      }

      throw new Error('STT_NO_TRANSCRIPT');
    },
  };
}
