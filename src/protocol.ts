import { stdin, stdout } from "process";
import { createInterface } from "readline";

const rl = createInterface({ input: stdin, terminal: false });
const lines: string[] = [];
let resolver: ((line: string) => void) | null = null;

rl.on("line", (line) => {
  if (resolver) {
    const r = resolver;
    resolver = null;
    r(line);
  } else {
    lines.push(line);
  }
});

export function send(msg: Record<string, unknown>): void {
  stdout.write(JSON.stringify(msg) + "\n");
}

export function recv(): Promise<string> {
  const buffered = lines.shift();
  if (buffered !== undefined) return Promise.resolve(buffered);
  return new Promise((resolve) => {
    resolver = resolve;
  });
}

export async function recvJson<T = Record<string, unknown>>(): Promise<T> {
  const line = await recv();
  return JSON.parse(line) as T;
}

export function sendOutput(text: string): void {
  send({ type: "output", text: text + "\n" });
}

export function sendError(msg: string): void {
  send({ type: "log", level: "error", message: msg });
}

export function sendLog(level: string, msg: string): void {
  send({ type: "log", level, message: msg });
}

let msgId = 0;
function nextId(): string {
  return String(++msgId);
}

export async function sendExec(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const id = nextId();
  send({ type: "exec", id, command });
  const resp = await recvJson<{ value: { code?: number; stdout?: string; stderr?: string } }>();
  const v = resp.value ?? {};
  return { stdout: v.stdout ?? "", stderr: v.stderr ?? "", code: v.code ?? 0 };
}

export function sendStore(key: string, value: string): void {
  send({ type: "store", key, value });
}

export async function sendLoad(key: string): Promise<string | null> {
  const id = nextId();
  send({ type: "load", id, key });
  const resp = await recvJson<{ value?: string | null }>();
  return resp.value ?? null;
}

export async function sendPrompt(message: string, defaultValue?: string): Promise<string> {
  const id = nextId();
  const msg: Record<string, unknown> = { type: "prompt", id, message };
  if (defaultValue !== undefined) msg.default = defaultValue;
  send(msg);
  const resp = await recvJson<{ value: string }>();
  return resp.value;
}

export async function sendConfirm(message: string): Promise<boolean> {
  const id = nextId();
  send({ type: "confirm", id, message });
  const resp = await recvJson<{ value: boolean }>();
  return resp.value;
}

export interface InitMessage {
  type: "init";
  protocol: string;
  args: string[];
  project: { name: string; root: string; language: string; git: Record<string, unknown> };
  plugin: { name: string; version: string; dir: string };
  fledge: { version: string };
  capabilities: { exec: boolean; store: boolean; metadata: boolean };
}
