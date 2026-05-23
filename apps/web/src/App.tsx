import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type Conversation = {
  id: string;
  title: string | null;
  sessionId: string | null;
  status: 'active' | 'cancelled' | 'archived';
  createdAt: string;
  updatedAt: string;
  lastMessagePreview?: string;
};

type Message = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
};

type StreamEvent =
  | { event: 'meta'; data: { conversationId: string; messageId: string; sessionId: string | null } }
  | { event: 'delta'; data: { conversationId: string; delta: string } }
  | { event: 'done'; data: { conversationId: string; messageId: string; text: string } }
  | { event: 'cancelled'; data: { ok: true } }
  | { event: 'error'; data: { message: string } };

type Provider = 'groq' | 'gemini';

type ContentBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'numbers'; items: string[] }
  | { type: 'code'; code: string; language?: string };

const inlinePattern = /(`[^`]+`|\[[^\]]+\]\((?:[^()\s]+)\)|\*\*[^*]+\*\*|\*[^*]+\*)/g;

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

function parseContentBlocks(content: string): ContentBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ContentBlock[] = [];
  let paragraphLines: string[] = [];
  let bulletItems: string[] = [];
  let numberItems: string[] = [];
  let codeLines: string[] | null = null;
  let codeLanguage: string | undefined;

  const flushParagraph = (): void => {
    const text = paragraphLines.join(' ').trim();
    if (text) {
      blocks.push({ type: 'paragraph', text });
    }
    paragraphLines = [];
  };

  const flushBullets = (): void => {
    if (bulletItems.length) {
      blocks.push({ type: 'bullets', items: bulletItems });
    }
    bulletItems = [];
  };

  const flushNumbers = (): void => {
    if (numberItems.length) {
      blocks.push({ type: 'numbers', items: numberItems });
    }
    numberItems = [];
  };

  const flushCode = (): void => {
    if (codeLines) {
      blocks.push({ type: 'code', code: codeLines.join('\n'), language: codeLanguage });
    }
    codeLines = null;
    codeLanguage = undefined;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith('```')) {
      if (codeLines) {
        flushCode();
      } else {
        flushParagraph();
        flushBullets();
        flushNumbers();
        codeLanguage = line.slice(3).trim() || undefined;
        codeLines = [];
      }
      continue;
    }

    if (codeLines) {
      codeLines.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushBullets();
      flushNumbers();
      continue;
    }

    const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph();
      flushNumbers();
      bulletItems.push(bulletMatch[1] ?? '');
      continue;
    }

    const numberMatch = line.match(/^\d+[.)]\s+(.*)$/);
    if (numberMatch) {
      flushParagraph();
      flushBullets();
      numberItems.push(numberMatch[1] ?? '');
      continue;
    }

    flushBullets();
    flushNumbers();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushBullets();
  flushNumbers();
  flushCode();

  return blocks;
}

function isSafeHref(value: string): boolean {
  try {
    const url = new URL(value, 'http://localhost');
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) || value.startsWith('/');
  } catch {
    return value.startsWith('/');
  }
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(inlinePattern)) {
    const token = match[0] ?? '';
    const index = match.index ?? 0;

    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code key={`${index}-code`} className="inline-code">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(<strong key={`${index}-bold`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(<em key={`${index}-italic`}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const label = linkMatch?.[1] ?? token;
      const href = linkMatch?.[2] ?? '';

      if (isSafeHref(href)) {
        nodes.push(
          <a key={`${index}-link`} href={href} target="_blank" rel="noreferrer noopener">
            {label}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(token);
    }

    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function MessageContent({ content, role }: { content: string; role: Message['role'] }): JSX.Element {
  if (!content && role === 'assistant') {
    return <p className="message-placeholder">...</p>;
  }

  const blocks = parseContentBlocks(content);

  if (blocks.length === 0) {
    return <p>{content}</p>;
  }

  return (
    <div className="message-content">
      {blocks.map((block, index) => {
        if (block.type === 'paragraph') {
          return <p key={index}>{renderInlineMarkdown(block.text)}</p>;
        }

        if (block.type === 'bullets') {
          return (
            <ul key={index} className="message-list bullets">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === 'numbers') {
          return (
            <ol key={index} className="message-list numbers">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
              ))}
            </ol>
          );
        }

        return <CodeBlock key={index} code={block.code} language={block.language} />;
      })}
    </div>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copyCode(): Promise<void> {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{language ?? 'code'}</span>
        <button type="button" className="copy-button" onClick={() => void copyCode()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [provider, setProvider] = useState<Provider>('groq');
  const [status, setStatus] = useState('Ready');
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const modelByProvider: Record<Provider, string> = {
    groq: 'llama-3.1-8b-instant',
    gemini: 'gemini-2.0-flash'
  };

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  );

  async function loadConversations(): Promise<void> {
    const response = await fetch(`${API_BASE}/conversations`);
    setConversations(await response.json());
  }

  async function loadMessages(conversationId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/conversations/${conversationId}/messages`);
    setMessages(await response.json());
  }

  useEffect(() => {
    void loadConversations();
  }, []);

  useEffect(() => {
    if (activeConversationId) {
      void loadMessages(activeConversationId);
    } else {
      setMessages([]);
    }
  }, [activeConversationId]);

  async function ensureConversation(): Promise<string> {
    if (activeConversationId) {
      return activeConversationId;
    }

    const response = await fetch(`${API_BASE}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: crypto.randomUUID() })
    });
    const conversation = (await response.json()) as Conversation;
    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    return conversation.id;
  }

  function applyEvent(event: StreamEvent): void {
    if (event.event === 'meta') {
      setActiveConversationId(event.data.conversationId);
      return;
    }

    if (event.event === 'delta') {
      setMessages((current) => {
        const next = [...current];
        const last = next.at(-1);
        if (last?.role !== 'assistant') {
          next.push({
            id: event.data.conversationId + '-stream',
            conversationId: event.data.conversationId,
            role: 'assistant',
            content: event.data.delta,
            createdAt: new Date().toISOString()
          });
        } else {
          last.content = `${last.content}${event.data.delta}`;
        }
        return next;
      });
    }

    if (event.event === 'done') {
      setMessages((current) => {
        const next = [...current];
        const last = next.at(-1);
        if (last?.role === 'assistant') {
          last.id = event.data.messageId;
          last.content = event.data.text;
          last.createdAt = new Date().toISOString();
        }
        return next;
      });
      setStatus('Response complete');
      setIsStreaming(false);
    }

    if (event.event === 'cancelled') {
      setStatus('Conversation cancelled');
      setIsStreaming(false);
    }

    if (event.event === 'error') {
      setStatus(event.data.message);
      setIsStreaming(false);
    }
  }

  async function sendMessage(): Promise<void> {
    const content = draft.trim();
    if (!content || isStreaming) {
      return;
    }

    const conversationId = await ensureConversation();
    const userMessage: Message = {
      id: crypto.randomUUID(),
      conversationId,
      role: 'user',
      content,
      createdAt: new Date().toISOString()
    };

    setDraft('');
    setStatus('Streaming response…');
    setIsStreaming(true);
    setMessages((current) => [
      ...current,
      userMessage,
      {
        id: `${conversationId}-assistant-stream`,
        conversationId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString()
      }
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    const response = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        message: content,
        provider,
        model: modelByProvider[provider],
        sessionId: activeConversation?.sessionId ?? crypto.randomUUID(),
        contextSize: 8
      }),
      signal: controller.signal
    });

    const reader = response.body?.getReader();
    if (!reader) {
      setStatus('No stream available from the server');
      setIsStreaming(false);
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let splitIndex = buffer.indexOf('\n\n');
      while (splitIndex !== -1) {
        const chunk = buffer.slice(0, splitIndex).trim();
        buffer = buffer.slice(splitIndex + 2);

        const eventLine = chunk.split('\n').find((line) => line.startsWith('event: '));
        const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
        if (eventLine && dataLine) {
          const event = eventLine.slice('event: '.length).trim();
          const data = JSON.parse(dataLine.slice('data: '.length));
          applyEvent({ event: event as StreamEvent['event'], data });
        }

        splitIndex = buffer.indexOf('\n\n');
      }
    }

    abortRef.current = null;
    await loadConversations();
    await loadMessages(conversationId);
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }

    event.preventDefault();
    void sendMessage();
  }

  async function cancelConversation(): Promise<void> {
    abortRef.current?.abort();
    if (!activeConversationId) {
      return;
    }

    await fetch(`${API_BASE}/conversations/${activeConversationId}/cancel`, { method: 'POST' });
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversationId ? { ...conversation, status: 'cancelled' } : conversation
      )
    );
    setStatus('Cancellation sent');
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <p className="eyebrow">Assessment build</p>
          <h1>LLM Inference Logger</h1>
          <p className="lede">Multi-turn chat, streamed responses, and logging ingestion in one repo.</p>
        </div>

        <button className="primary" onClick={() => setActiveConversationId(null)}>
          New conversation
        </button>

        <div className="conversation-list">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              className={`conversation-card ${conversation.id === activeConversationId ? 'active' : ''}`}
              onClick={() => setActiveConversationId(conversation.id)}
            >
              <div className="row">
                <strong>{conversation.title ?? 'Untitled conversation'}</strong>
                <span className={`status ${conversation.status}`}>{conversation.status}</span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Conversation</p>
            <h2>{activeConversation?.title ?? activeConversation?.id ?? 'Start a new thread'}</h2>
          </div>
          <div className="actions">
            <button
              className="secondary"
              disabled={!activeConversationId || isStreaming}
              onClick={() => void loadMessages(activeConversationId ?? '')}
            >
              Resume
            </button>
            <button className="secondary danger" disabled={!activeConversationId || !isStreaming} onClick={() => void cancelConversation()}>
              Cancel
            </button>
          </div>
        </header>

        <section className="messages">
          {messages.map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              <div className="message-meta">
                <span>{message.role}</span>
                <time>{formatTime(message.createdAt)}</time>
              </div>
              <MessageContent content={message.content} role={message.role} />
            </article>
          ))}
        </section>

        <footer className="composer">
          <textarea
            placeholder="Ask something, then watch the response stream in real time."
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            rows={4}
          />
          <div className="composer-actions">
            <label className="provider-select">
              <span>Provider</span>
              <select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>
                <option value="groq">Groq</option>
                <option value="gemini">Gemini</option>
              </select>
            </label>
            <span className="status-line">{status}</span>
            <button className="primary" disabled={isStreaming} onClick={() => void sendMessage()}>
              Send
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}