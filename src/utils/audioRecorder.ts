/**
 * AudioSentenceRecorder: Captures raw microphone audio chunks from MediaStream
 * and exports base64-encoded WebM audio clips for Gemini Multimodal Audio analysis.
 */

export class AudioSentenceRecorder {
  private mediaStream: MediaStream;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private isRecording = false;
  private maxBufferSize = 25; // keep last ~15-20 seconds (at 1000ms chunks)

  constructor(stream: MediaStream) {
    this.mediaStream = stream;
    this.initRecorder();
  }

  private initRecorder() {
    if (typeof window === 'undefined' || !window.MediaRecorder) {
      console.warn('MediaRecorder is not supported in this environment.');
      return;
    }

    try {
      // Pick best supported mimeType
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ];
      let selectedMimeType = '';
      for (const mime of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mime)) {
          selectedMimeType = mime;
          break;
        }
      }

      const options = selectedMimeType ? { mimeType: selectedMimeType } : undefined;
      this.mediaRecorder = new MediaRecorder(this.mediaStream, options);

      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
          // Keep a rolling buffer of recent speech
          if (this.recordedChunks.length > this.maxBufferSize) {
            this.recordedChunks.shift();
          }
        }
      };

      this.mediaRecorder.onerror = (e) => {
        console.warn('MediaRecorder error:', e);
      };
    } catch (err) {
      console.error('Failed to create MediaRecorder:', err);
    }
  }

  public start() {
    if (!this.mediaRecorder || this.isRecording) return;
    try {
      this.recordedChunks = [];
      this.mediaRecorder.start(1000); // 1-second chunks
      this.isRecording = true;
    } catch (err) {
      console.warn('Could not start MediaRecorder:', err);
    }
  }

  public stop() {
    if (!this.mediaRecorder || !this.isRecording) return;
    try {
      this.mediaRecorder.stop();
      this.isRecording = false;
    } catch (err) {
      console.warn('Could not stop MediaRecorder:', err);
    }
  }

  /**
   * Exports recent audio chunks (e.g. last 4-8 chunks covering the sentence) as a base64 WebM string.
   */
  public async exportRecentAudioBase64(chunkCount = 8): Promise<{
    base64: string;
    mimeType: string;
  } | null> {
    if (this.recordedChunks.length === 0) return null;

    try {
      const recent = this.recordedChunks.slice(-chunkCount);
      const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
      const audioBlob = new Blob(recent, { type: mimeType });

      if (audioBlob.size < 500) {
        // Blob too small / silent
        return null;
      }

      const arrayBuffer = await audioBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      return {
        base64,
        mimeType: mimeType.split(';')[0] || 'audio/webm',
      };
    } catch (err) {
      console.error('Error exporting audio chunk:', err);
      return null;
    }
  }

  public clearBuffer() {
    this.recordedChunks = [];
  }
}
