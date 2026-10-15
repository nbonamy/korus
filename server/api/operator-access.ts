import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const lifetime = 7200000;
const digest = (value: string) => createHash("sha256").update(value).digest();

/** Short-lived operator access only; never an installation or telemetry identity. */
export class OperatorAccess {
  private readonly secret: Buffer;
  private readonly sessions = new Map<string, number>();
  private readonly cookieName: string;
  constructor(
    token: string,
    private readonly secure = true,
  ) {
    this.secret = digest(token);
    this.cookieName = secure ? "__Host-console_session" : "console_session";
  }
  private matches(value: string): boolean {
    return timingSafeEqual(this.secret, digest(value));
  }
  private session(header: string | undefined): string | null {
    const cookieName = this.cookieName;
    const values = (header ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith(cookieName + "="));
    if (values.length !== 1) return null;
    const value = values[0]!.slice(cookieName.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(value)
      ? digest(value).toString("hex")
      : null;
  }
  private prune(): void {
    for (const [id, expires] of this.sessions)
      if (expires <= Date.now()) this.sessions.delete(id);
  }
  authenticated(
    authorization: string | undefined,
    cookies: string | undefined,
  ): boolean {
    this.prune();
    const id = this.session(cookies);
    if (id && this.sessions.has(id)) return true;
    const value = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    return this.matches(value);
  }
  signIn(password: string): string | null {
    if (!this.matches(password)) return null;
    this.prune();
    while (this.sessions.size >= 128)
      this.sessions.delete(this.sessions.keys().next().value!);
    const value = randomBytes(32).toString("base64url");
    this.sessions.set(digest(value).toString("hex"), Date.now() + lifetime);
    return this.cookie(value, lifetime / 1000);
  }
  signOut(cookies: string | undefined): string {
    const id = this.session(cookies);
    if (id) this.sessions.delete(id);
    return this.cookie("", 0);
  }
  private cookie(value: string, seconds: number): string {
    return `${this.cookieName}=${value}; Path=/; HttpOnly; ${this.secure ? "Secure; " : ""}SameSite=Strict; Max-Age=${seconds}`;
  }
  close(): void {
    this.sessions.clear();
  }
}
