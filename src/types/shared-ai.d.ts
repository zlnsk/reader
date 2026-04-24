// Ambient module declaration for the shared-ai package.
// Resolved via the SHARED_MODULES_DIR symlink set up in postinstall.
// node_modules/shared-ai by the postinstall hook). On CI the symlink
// target doesn't exist — this file makes tsc happy without needing
// the runtime package to be installed.
declare module "shared-ai" {
  export type ChatMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content: string | Array<Record<string, unknown>>;
  };
  export interface ChatOptions {
    apiKey: string;
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    responseFormat?: { type: "json_object" | "text" };
    referer?: string;
    appName?: string;
    timeoutMs?: number;
    retry?: boolean;
    signal?: AbortSignal;
  }
  export interface ChatResult { content: string; raw: unknown }
  export function chatCompletion(opts: ChatOptions): Promise<ChatResult>;
  export function chatText(opts: ChatOptions): Promise<string>;
  export function chatJson<T = unknown>(opts: ChatOptions): Promise<T | null>;
  export function parseJsonLoose<T = unknown>(s: string | null | undefined): T | null;
  export interface StreamIterable extends AsyncIterable<string> { text(): Promise<string> }
  export function streamOpenRouter(opts: ChatOptions): Promise<StreamIterable>;
}
