type ProgressOptions = {
  errorPrefix?: string;
  emptyMessage?: string;
  defaultStage?: string;
  onProgress?: (stage: string, progress: number) => void;
};
type ProgressEvent = {
  type?: string;
  error?: string | { message?: unknown };
  result?: unknown;
  stage?: string;
  progress?: unknown;
};

export async function readProgressStream(response: Response, options: ProgressOptions = {}): Promise<unknown> {
  const {
    errorPrefix = "Request failed",
    emptyMessage = "Progress stream closed before returning a result.",
    defaultStage = "Running",
    onProgress = () => {},
  } = options;

  if (!response.ok) {
    const result = (await response.json().catch((): null => null)) as { error?: string } | null;
    throw new Error(result?.error || `${errorPrefix} (${response.status})`);
  }
  if (!response.body) {
    return response.json();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const result = handleProgressLine(line, { errorPrefix, defaultStage, onProgress });
        if (result) return result;
      }
    }
    if (done) break;
  }

  if (buffer.trim()) {
    const result = handleProgressLine(buffer, { errorPrefix, defaultStage, onProgress });
    if (result) return result;
  }
  throw new Error(emptyMessage);
}

function handleProgressLine(
  line: string,
  {
    errorPrefix,
    defaultStage,
    onProgress,
  }: Required<Pick<ProgressOptions, "errorPrefix" | "defaultStage" | "onProgress">>,
): unknown | null {
  if (!line.trim()) return null;
  const event = parseProgressEvent(line, errorPrefix);
  if (event.type === "error" || event.type === "cancelled") {
    throw new Error(eventErrorMessage(event.error, errorPrefix));
  }
  if (event.type === "complete") {
    onProgress("Complete", 1);
    return event.result;
  }
  onProgress(event.stage || defaultStage, normalizeProgress(event.progress));
  return null;
}

function parseProgressEvent(line: string, errorPrefix: string): ProgressEvent {
  try {
    const event = JSON.parse(line) as unknown;
    return event && typeof event === "object" ? (event as ProgressEvent) : {};
  } catch {
    throw new Error(`${errorPrefix}: received malformed progress event.`);
  }
}

function eventErrorMessage(error: ProgressEvent["error"], errorPrefix: string): string {
  if (typeof error === "string") return error.trim() ? error : `${errorPrefix}.`;
  if (error && typeof error.message === "string" && error.message.trim()) return error.message;
  return `${errorPrefix}.`;
}

function normalizeProgress(value: unknown): number {
  const progress = Number(value);
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}
