import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useEffect, useRef, useState } from "react";

const appendResponse = createServerFn({ method: "POST" })
.inputValidator((data: { userMessage: string; response: string }) => data)
.handler(async ({ data }) => {
const filePath = resolve(process.cwd(), "responses.txt");
const timestamp = new Date().toISOString();
const entry = `\n--- ${timestamp} ---\nUser: ${data.userMessage}\nQwen: ${data.response}\n`;
appendFileSync(filePath, entry, "utf8");
});

const loadHistory = createServerFn({ method: "GET" }).handler(async () => {
const filePath = resolve(process.cwd(), "responses.txt");
if (!existsSync(filePath)) return "";
return readFileSync(filePath, "utf8");
});

function parseHistory(content: string): Message[] {
const messages: Message[] = [];
const entries = content.split(/\n---\s[^\n]+\s---\n/).filter(Boolean);
for (const entry of entries) {
const userMatch = entry.match(/^User: ([\s\S]*?)\nQwen: /);
const qwenMatch = entry.match(/\nQwen: ([\s\S]*)$/);
if (userMatch && qwenMatch) {
messages.push({ role: "user", content: userMatch[1].trim(), fromHistory: true });
messages.push({ role: "assistant", content: qwenMatch[1].trim(), fromHistory: true });
}
}
return messages;
}

// Change MODEL to match whatever name you used when running `ollama pull`
const OLLAMA_URL = "http://127.0.0.1:11434";
const MODEL = "qwen3.6:latest";

interface Message {
role: "user" | "assistant";
content: string;
truncated?: boolean;
fromHistory?: boolean;
}

interface TokenUsage {
prompt: number;
completion: number;
}

export const Route = createFileRoute("/")({ component: App });

function App() {
const [messages, setMessages] = useState<Message[]>([]);
const [input, setInput] = useState("");
const [loading, setLoading] = useState(false);
const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);
const messagesEndRef = useRef<HTMLDivElement>(null);
const messagesContainerRef = useRef<HTMLDivElement>(null);
const textareaRef = useRef<HTMLTextAreaElement>(null);

useEffect(() => {
loadHistory()
.then((content) => {
const parsed = parseHistory(content);
if (parsed.length > 0) setMessages(parsed);
})
.catch(console.error);
}, []);

useEffect(() => {
const container = messagesContainerRef.current;
if (container) {
container.scrollTop = container.scrollHeight;
}
}, [messages]);

async function sendMessage() {
const text = input.trim();
if (!text || loading) return;

// Only send current-session messages as Ollama context (not loaded history)
const sessionMessages = messages.filter((m) => !m.fromHistory);
const history: Message[] = [
...sessionMessages,
{ role: "user", content: text },
];

setMessages((prev) => [
...prev,
{ role: "user", content: text },
{ role: "assistant", content: "" },
]);
setInput("");
if (textareaRef.current) {
textareaRef.current.style.height = "auto";
}
setLoading(true);

try {
const res = await fetch(`${OLLAMA_URL}/api/chat`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
model: MODEL,
messages: history.map(({ role, content }) => ({ role, content })),
stream: true,
think: false,
}),
});

if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

const reader = res.body.getReader();
const decoder = new TextDecoder();
let fullResponse = "";
let promptTokens = 0;
let completionTokens = 0;
let contextExhausted = false;

while (true) {
const { done, value } = await reader.read();
if (done) break;
const lines = decoder
.decode(value, { stream: true })
.split("\n")
.filter(Boolean);
for (const line of lines) {
try {
const data = JSON.parse(line);
if (data.message?.content) {
fullResponse += data.message.content;
setMessages((prev) => {
const updated = [...prev];
updated[updated.length - 1] = {
role: "assistant",
content: updated[updated.length - 1].content + data.message.content,
};
return updated;
});
}
if (data.done) {
promptTokens = data.prompt_eval_count ?? 0;
completionTokens = data.eval_count ?? 0;
contextExhausted = data.done_reason === "length";
}
} catch {
// skip malformed chunk
}
}
}

setTokenUsage({ prompt: promptTokens, completion: completionTokens });

if (contextExhausted) {
setMessages((prev) => {
const updated = [...prev];
updated[updated.length - 1] = {
...updated[updated.length - 1],
truncated: true,
};
return updated;
});
}

if (fullResponse) {
// Fire-and-forget — do NOT await to avoid triggering route revalidation
appendResponse({
data: { userMessage: text, response: fullResponse },
}).catch(console.error);
}
} catch (err) {
setMessages((prev) => {
const updated = [...prev];
updated[updated.length - 1] = {
role: "assistant",
content: `Error: ${err instanceof Error ? err.message : "Failed to connect to Ollama."}`,
};
return updated;
});
} finally {
setLoading(false);
}
}

function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
if (e.key === "Enter" && !e.shiftKey) {
e.preventDefault();
sendMessage();
}
}

function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
setInput(e.target.value);
const el = e.target;
el.style.height = "auto";
el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
}

const hasHistory = messages.some((m) => m.fromHistory);

return (
<main
className="page-wrap px-4 pb-4 pt-14 flex flex-col"
style={{ height: "100dvh" }}
>
<div
className="island-shell flex flex-col overflow-hidden rounded-[2rem] flex-1"
style={{ minHeight: 0, maxHeight: "80%" }}
>
{/* Chat header */}
<div className="flex items-center gap-3 border-b border-[var(--line)] px-6 py-3">
<span className="h-2.5 w-2.5 rounded-full bg-[linear-gradient(90deg,#56c6be,#7ed3bf)] shadow-[0_0_8px_rgba(79,184,178,0.5)]" />
<span className="text-sm font-semibold text-[var(--sea-ink)]">
{MODEL}
</span>
<span className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 py-0.5 text-xs text-[var(--sea-ink-soft)]">
Ollama · {OLLAMA_URL}
</span>
{tokenUsage && (
<span
className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 py-0.5 text-xs text-[var(--sea-ink-soft)]"
title={`Prompt: ${tokenUsage.prompt.toLocaleString()} tokens · Completion: ${tokenUsage.completion.toLocaleString()} tokens`}
>
{(tokenUsage.prompt + tokenUsage.completion).toLocaleString()} tokens
</span>
)}
<button
onClick={() => { setMessages([]); setTokenUsage(null); }}
disabled={messages.length === 0}
className="ml-auto flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--sea-ink-soft)] transition hover:border-[var(--lagoon)] hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-30"
title="Start a new chat and reset context"
>
<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
<path d="M3 3v5h5" />
</svg>
New Chat
</button>
</div>

{/* Messages */}
<div
ref={messagesContainerRef}
className="flex-1 overflow-y-auto space-y-4 px-4 py-5 sm:px-6"
style={{ minHeight: 0 }}
>
{messages.length === 0 && (
<div className="flex h-full flex-col items-center justify-center gap-3 text-center">
<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-[var(--lagoon)] opacity-60">
<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
</svg>
<p className="text-sm text-[var(--sea-ink-soft)]">
Start a conversation with <strong>{MODEL}</strong>
</p>
<p className="text-xs text-[var(--sea-ink-soft)] opacity-70">
Enter to send · Shift+Enter for a new line
</p>
</div>
)}

{hasHistory && (
<div className="flex items-center gap-3 py-1">
<div className="h-px flex-1 bg-[var(--line)]" />
<span className="text-xs text-[var(--sea-ink-soft)] opacity-60">Previous sessions</span>
<div className="h-px flex-1 bg-[var(--line)]" />
</div>
)}

{messages.map((msg, i) => (
<div key={i}>
{/* Divider before first current-session message */}
{!msg.fromHistory && (i === 0 || messages[i - 1]?.fromHistory) && hasHistory && (
<div className="flex items-center gap-3 py-1 mb-4">
<div className="h-px flex-1 bg-[var(--line)]" />
<span className="text-xs text-[var(--sea-ink-soft)] opacity-60">Current session</span>
<div className="h-px flex-1 bg-[var(--line)]" />
</div>
)}
<div
className={`flex items-end gap-2.5 ${msg.fromHistory ? "opacity-50" : ""} ${msg.role === "user" ? "justify-end" : "justify-start"}`}
>
{msg.role === "assistant" && (
<div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[linear-gradient(135deg,rgba(79,184,178,0.25),rgba(47,106,74,0.15))] text-xs font-bold text-[var(--lagoon-deep)]">
Q
</div>
)}
<div
className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
msg.role === "user"
? "rounded-br-sm bg-[var(--lagoon-deep)] text-white"
: "rounded-bl-sm border border-[var(--line)] bg-[var(--surface-strong)] text-[var(--sea-ink)]"
}`}
>
{msg.content === "" && loading && i === messages.length - 1 ? (
<span className="inline-flex gap-1">
<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
</span>
) : (
msg.content
)}
{msg.truncated && (
<div className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
<line x1="12" y1="9" x2="12" y2="13" />
<line x1="12" y1="17" x2="12.01" y2="17" />
</svg>
Response cut off — context window full. Start a new chat to continue.
</div>
)}
</div>
{msg.role === "user" && (
<div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[var(--lagoon-deep)] text-xs font-bold text-white">
U
</div>
)}
</div>
</div>
))}
<div ref={messagesEndRef} />
</div>

{/* Input bar */}
<div className="border-t border-[var(--line)] px-4 py-3 sm:px-6">
<div className="flex items-end gap-2.5">
<textarea
ref={textareaRef}
value={input}
onChange={handleInputChange}
onKeyDown={handleKeyDown}
placeholder={`Message ${MODEL}…`}
rows={1}
disabled={loading}
className="flex-1 resize-none rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2.5 text-sm text-[var(--sea-ink)] placeholder:text-[var(--sea-ink-soft)] outline-none transition focus:border-[var(--lagoon)] disabled:opacity-50"
style={{ minHeight: "42px", maxHeight: "200px" }}
/>
<button
onClick={sendMessage}
disabled={!input.trim() || loading}
className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-full bg-[var(--lagoon-deep)] text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
aria-label="Send"
>
{loading ? (
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
<path d="M21 12a9 9 0 1 1-6.219-8.56" />
</svg>
) : (
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
<path d="M22 2L11 13" />
<path d="M22 2L15 22 11 13 2 9l20-7z" />
</svg>
)}
</button>
</div>
</div>
</div>
</main>
);
}
