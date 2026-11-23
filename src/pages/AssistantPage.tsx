import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { apiRequest } from '../api.ts';
import { PageHeader } from '../components/StatusText.tsx';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  meta?: string;
}

const SUGGESTED_QUESTIONS = [
  'Which bins are at critical risk?',
  'Which zone needs immediate collection?',
  'Which vehicle is available?',
  'How many bins may overflow today?',
  'Show the highest-priority collection list.',
  "Summarize today's waste collection performance.",
];

export function AssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init',
      sender: 'assistant',
      text: 'Hello, I am WasteGuard AI. Ask any operational question about critical bins, zone urgency, vehicle availability, overflow forecasts, or collection performance. All answers are strictly grounded in live SQLite records.',
      meta: 'Grounded in urban_waste_management.db',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendPrompt = async (promptText: string) => {
    const q = promptText.trim();
    if (!q || loading) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, sender: 'user', text: q };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await apiRequest<{
        answer: string;
        mode: string;
        modelUsed: string;
      }>('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message: q }),
      });

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          sender: 'assistant',
          text: res.answer,
          meta: `${res.modelUsed} · Live SQLite Snapshot`,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          sender: 'assistant',
          text: err instanceof Error ? err.message : 'Unable to reach WasteGuard AI service.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendPrompt(input);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="WasteGuard AI Operations Assistant"
        subtitle="Answers operational queries strictly from live SQLite tables via server-side Gemini API (with automatic SQLite query fallback when unconfigured)."
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3 h-fit">
          <h2 className="text-sm font-semibold">Operational Query Presets</h2>
          <div className="space-y-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => sendPrompt(q)}
                disabled={loading}
                className="w-full text-left px-3 py-2 text-xs rounded-md border border-slate-200 dark:border-slate-800 hover:border-teal-600 dark:hover:border-teal-500 text-slate-700 dark:text-slate-300 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col h-[540px]">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                    m.sender === 'user'
                      ? 'bg-teal-700 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {m.text}
                </div>
                {m.meta && (
                  <span className="mt-1 text-[11px] text-slate-400 font-mono">{m.meta}</span>
                )}
              </div>
            ))}
            {loading && (
              <div className="text-xs text-slate-500 font-mono">
                Querying SQLite database and analyzing...
              </div>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask WasteGuard AI about critical bins, zones, vehicles, or schedules..."
              className="flex-1 px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              <span>Send</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
