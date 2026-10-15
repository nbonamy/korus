import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { startApiServer } from "../server";
import { utcDay } from "@workspace/core/telemetry";
import type { ModelBehavior } from "../telemetry/model-behavior";
it("generates and deletes an authenticated demo dataset without changing or deleting real reports", async () => {
  const token = "isolated-demo-validation-operator-secret-only";
  const service = await startApiServer({
    database: ":memory:",
    operatorToken: token,
    host: "127.0.0.1",
    port: 0,
    synthetic: true,
  });
  const auth = { authorization: "Bearer " + token, origin: service.url };
  const day = utcDay(Date.now()),
    from = utcDay(Date.now() - 6 * 86400000);
  const query = `${service.url}/v1/telemetry/metrics?from=${from}&to=${day}&dimension=provider`;
  const read = () =>
    fetch(query, { headers: auth }).then((response) =>
      response.json(),
    ) as Promise<{ demo: boolean; rows: { total: number; value: string }[] }>;
  try {
    expect(
      (
        await fetch(service.url + "/v1/telemetry/demo", {
          method: "POST",
          headers: { origin: service.url },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(service.url + "/v1/telemetry/demo", {
          method: "POST",
          headers: { ...auth, origin: "https://other.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(service.url + "/v1/telemetry/reports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schema: 1,
            reportId: randomUUID(),
            family: "runtime",
            version: "0.35.0",
            channel: "stable",
            platform: "macos",
            client: "daemon",
            rows: [
              {
                day,
                metric: "turn.started",
                provider: "codex",
                model: "unknown",
                value: 1,
              },
            ],
          }),
        })
      ).status,
    ).toBe(200);
    const real = await read();
    expect(real.demo).toBe(false);
    expect(real.rows.map((row) => row.total)).toStrictEqual([1]);
    for (let i = 0; i < 2; i++) {
      expect(
        (
          await fetch(service.url + "/v1/telemetry/demo", {
            method: "POST",
            headers: auth,
          })
        ).status,
      ).toBe(200);
      const demo = await read();
      expect(demo.demo).toBe(true);
      expect(demo.rows.length).toBeGreaterThan(10);
      expect(new Set(demo.rows.map((row) => row.value))).toStrictEqual(
        new Set(["claude", "codex", "antigravity"]),
      );
      const behavior = (await fetch(
        query.replace("dimension=provider", "dimension=model"),
        { headers: auth },
      ).then((response) => response.json())) as {
        behavior: ModelBehavior[];
      };
      expect(
        behavior.behavior.some(
          (model) => model.metrics.streamRate.value !== null,
        ),
      ).toBe(true);
      for (const model of ["gpt-5.4", "gemini-2.5-pro"]) {
        const sample = behavior.behavior.find((row) => row.model === model);
        expect(sample?.metrics.streamRate.value).toBeGreaterThan(0);
        expect(sample?.metrics.toolsPerTurn.value).toBeGreaterThan(0);
      }
      expect(
        (
          await fetch(service.url + "/v1/telemetry/demo", {
            method: "DELETE",
            headers: auth,
          })
        ).status,
      ).toBe(200);
      expect(await read()).toStrictEqual(real);
    }
  } finally {
    await service.close();
  }
});
