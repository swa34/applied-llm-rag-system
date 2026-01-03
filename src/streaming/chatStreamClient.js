/**
 * Streaming Chat Client
 *
 * Browser-side client for RAG chat with intelligent response handling.
 * Features:
 * - Instant cached responses (JSON) when available
 * - Progressive streaming (SSE) for cache misses
 * - Session management with persistence
 * - Source attribution display
 * - Error recovery and stream interruption handling
 *
 * Works with the server-side cache layer to provide
 * sub-100ms responses for frequently asked questions.
 *
 * @author Scott Anderson
 */

class StreamingChatClient {
  /**
   * @param {Object} config - Client configuration
   * @param {string} config.apiUrl - Chat endpoint URL
   * @param {string} config.apiKey - API key for authentication
   * @param {Function} config.onMessageUpdate - Called when message content changes
   * @param {Function} config.onStreamStart - Called when streaming begins
   * @param {Function} config.onStreamEnd - Called when response completes
   * @param {Function} config.onError - Called on errors
   */
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || '/chat/stream';
    this.apiKey = config.apiKey;
    this.sessionId = this.getOrCreateSessionId();
    this.messages = [];
    this.isStreaming = false;
    this.abortController = null;

    // Callbacks
    this.onMessageUpdate = config.onMessageUpdate || (() => {});
    this.onStreamStart = config.onStreamStart || (() => {});
    this.onStreamEnd = config.onStreamEnd || (() => {});
    this.onError = config.onError || ((error) => console.error('Chat error:', error));
  }

  /**
   * Get or create a persistent session ID
   */
  getOrCreateSessionId() {
    const storageKey = 'ragChatSessionId';
    let sessionId = sessionStorage.getItem(storageKey);

    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem(storageKey, sessionId);
    }

    return sessionId;
  }

  /**
   * Generate unique message ID
   */
  generateMessageId(suffix = '') {
    return `msg_${Date.now()}${suffix ? '_' + suffix : ''}_${Math.random().toString(36).substr(2, 5)}`;
  }

  /**
   * Send a message and handle response
   * Automatically detects cached (JSON) vs streaming (SSE) responses
   */
  async sendMessage(message, options = {}) {
    if (this.isStreaming && !options.force) {
      console.warn('Already streaming a response. Use force: true to override.');
      return null;
    }

    // Stop any existing stream
    if (this.isStreaming) {
      this.stopStream();
    }

    // Create user message
    const userMessage = {
      id: this.generateMessageId('user'),
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    };
    this.messages.push(userMessage);
    this.onMessageUpdate(userMessage);

    // Create assistant message placeholder
    const assistantMessage = {
      id: this.generateMessageId('assistant'),
      role: 'assistant',
      content: '',
      sources: [],
      cached: false,
      streaming: true,
      timestamp: new Date().toISOString()
    };
    this.messages.push(assistantMessage);
    this.onMessageUpdate(assistantMessage);

    // Setup abort controller for cancellation
    this.abortController = new AbortController();

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'x-api-key': this.apiKey })
        },
        body: JSON.stringify({
          message,
          sessionId: this.sessionId,
          ...options.metadata
        }),
        credentials: 'include',
        signal: this.abortController.signal
      });

      // Handle authentication errors
      if (response.status === 401) {
        throw new Error('Authentication required');
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');

      if (contentType?.includes('application/json')) {
        // CACHE HIT: Instant response
        await this.handleCachedResponse(response, assistantMessage);
      } else if (contentType?.includes('text/event-stream')) {
        // CACHE MISS: Stream response
        await this.handleStreamingResponse(response, assistantMessage);
      } else {
        throw new Error(`Unexpected content type: ${contentType}`);
      }

      return assistantMessage;

    } catch (error) {
      if (error.name === 'AbortError') {
        assistantMessage.content += '\n\n[Response cancelled]';
        assistantMessage.cancelled = true;
      } else {
        assistantMessage.content = `Error: ${error.message}`;
        assistantMessage.error = true;
        this.onError(error);
      }

      assistantMessage.streaming = false;
      this.onMessageUpdate(assistantMessage);
      return assistantMessage;

    } finally {
      this.isStreaming = false;
      this.abortController = null;
    }
  }

  /**
   * Handle instant cached JSON response
   */
  async handleCachedResponse(response, message) {
    const data = await response.json();

    message.content = data.answer || data.response || data.content;
    message.sources = data.sources || [];
    message.cached = true;
    message.streaming = false;
    message.cacheId = data.cacheId;
    message.responseTime = data.responseTime;

    this.onMessageUpdate(message);
    this.onStreamEnd(message);

    console.log('✅ Instant cached response', {
      cacheId: data.cacheId,
      responseTime: data.responseTime,
      sourcesCount: message.sources.length
    });
  }

  /**
   * Handle Server-Sent Events streaming response
   */
  async handleStreamingResponse(response, message) {
    this.isStreaming = true;
    this.onStreamStart();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Decode and buffer
        buffer += decoder.decode(value, { stream: true });

        // Process complete events (double newline delimited)
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const eventText of events) {
          if (!eventText.trim()) continue;

          const event = this.parseSSEEvent(eventText);
          if (event) {
            await this.handleSSEEvent(event, message);
          }
        }
      }

      // Mark complete
      message.streaming = false;
      this.onMessageUpdate(message);

    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Stream error:', error);
        message.content += '\n\n[Stream interrupted]';
        message.error = true;
        this.onMessageUpdate(message);
        this.onError(error);
      }

    } finally {
      this.isStreaming = false;
      this.onStreamEnd(message);
    }
  }

  /**
   * Parse SSE event text into structured object
   */
  parseSSEEvent(eventText) {
    const lines = eventText.split('\n');
    const event = { type: null, data: null };

    for (const line of lines) {
      if (line.startsWith('event:')) {
        event.type = line.substring(6).trim();
      } else if (line.startsWith('data:')) {
        const dataStr = line.substring(5).trim();
        try {
          event.data = JSON.parse(dataStr);
        } catch {
          event.data = dataStr;
        }
      }
    }

    return event.type ? event : null;
  }

  /**
   * Handle individual SSE event
   */
  async handleSSEEvent(event, message) {
    switch (event.type) {
      case 'response.start':
        console.log('🔄 Stream started:', event.data);
        break;

      case 'message.delta':
      case 'content.delta':
        // Append content progressively
        message.content += event.data.delta || event.data.content || '';
        this.onMessageUpdate(message);
        break;

      case 'sources':
        // Sources typically arrive at the end
        message.sources = event.data.sources || [];
        this.onMessageUpdate(message);
        console.log('📚 Sources received:', message.sources.length);
        break;

      case 'metadata':
        // Store additional metadata
        message.metadata = { ...message.metadata, ...event.data };
        break;

      case 'response.end':
      case 'done':
        console.log('✅ Stream complete:', event.data);
        break;

      case 'error':
        console.error('❌ Stream error:', event.data);
        message.error = true;
        message.content += `\n\n[Error: ${event.data.error || event.data.message}]`;
        this.onMessageUpdate(message);
        this.onError(new Error(event.data.error || 'Stream error'));
        break;

      default:
        console.debug('Unknown event:', event.type, event.data);
    }
  }

  /**
   * Stop the current streaming response
   */
  stopStream() {
    if (this.abortController) {
      this.abortController.abort();
      this.isStreaming = false;
    }
  }

  /**
   * Clear chat history and reset session
   */
  clearHistory() {
    this.stopStream();
    this.messages = [];
    sessionStorage.removeItem('ragChatSessionId');
    this.sessionId = this.getOrCreateSessionId();
  }

  /**
   * Get all messages in the conversation
   */
  getMessages() {
    return [...this.messages];
  }

  /**
   * Get the last assistant message
   */
  getLastResponse() {
    return this.messages.filter(m => m.role === 'assistant').pop() || null;
  }

  /**
   * Check if currently streaming
   */
  isCurrentlyStreaming() {
    return this.isStreaming;
  }

  /**
   * Export conversation for persistence
   */
  exportConversation() {
    return {
      sessionId: this.sessionId,
      messages: this.messages,
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import a previously exported conversation
   */
  importConversation(data) {
    if (data.sessionId) this.sessionId = data.sessionId;
    if (data.messages) this.messages = data.messages;
  }
}

// Export for browser and Node.js
if (typeof window !== 'undefined') {
  window.StreamingChatClient = StreamingChatClient;
}

export default StreamingChatClient;
