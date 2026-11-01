/** Browser credentials exist only in the form and this single same-origin POST. */
export async function sessionRequest(
  method: "GET" | "POST" | "DELETE",
  signal: AbortSignal,
  credentials?: { username: string; password: string },
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = setTimeout(abort, 10000);
  try {
    return await fetch("/auth/session", {
      method,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      ...(credentials
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: credentials.username,
              password: credentials.password,
            }),
          }
        : {}),
    });
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
