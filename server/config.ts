import { Config, Context, Effect, Layer } from "effect";
import { resolve } from "node:path";

export interface ZenithServerConfigService {
  readonly host: string;
  readonly port: number;
  readonly clientDirectory: string;
  readonly runtimeDirectory: string;
  readonly tlsCertificatePath: string;
  readonly tlsPrivateKeyPath: string;
  readonly runwayApiSecret: string;
  readonly runwayApiBase: string;
  readonly runwayApiVersion: string;
  readonly runwayPollIntervalMs: number;
  readonly runwayPollTimeoutMs: number;
}

export class ZenithServerConfig extends Context.Tag("zenith/server/Config")<
  ZenithServerConfig,
  ZenithServerConfigService
>() {
  static readonly Live = Layer.effect(
    ZenithServerConfig,
    Config.all({
      host: Config.string("ZENITH_HOST").pipe(Config.withDefault("127.0.0.1")),
      port: Config.integer("ZENITH_PORT").pipe(Config.withDefault(4173)),
      clientDirectory: Config.string("ZENITH_CLIENT_DIR").pipe(
        Config.withDefault(resolve(process.cwd(), "dist/client")),
      ),
      runtimeDirectory: Config.string("ZENITH_RUNTIME_DIR").pipe(
        Config.withDefault(resolve(process.cwd(), ".zenith-runtime")),
      ),
      tlsCertificatePath: Config.string("ZENITH_TLS_CERT_PATH").pipe(Config.withDefault("")),
      tlsPrivateKeyPath: Config.string("ZENITH_TLS_KEY_PATH").pipe(Config.withDefault("")),
      runwayApiSecret: Config.string("RUNWAYML_API_SECRET").pipe(Config.withDefault("")),
      runwayApiBase: Config.string("RUNWAY_API_BASE").pipe(Config.withDefault("https://api.dev.runwayml.com")),
      runwayApiVersion: Config.string("RUNWAY_API_VERSION").pipe(Config.withDefault("2024-11-06")),
      runwayPollIntervalMs: Config.integer("RUNWAY_POLL_INTERVAL_MS").pipe(Config.withDefault(2_500)),
      runwayPollTimeoutMs: Config.integer("RUNWAY_POLL_TIMEOUT_MS").pipe(Config.withDefault(8 * 60 * 1_000)),
    }).pipe(
      Effect.map((config) => ({
        ...config,
        host: config.host.trim() || "127.0.0.1",
        port: positiveInteger(config.port, 4173),
        runwayPollIntervalMs: positiveInteger(config.runwayPollIntervalMs, 2_500),
        runwayPollTimeoutMs: positiveInteger(config.runwayPollTimeoutMs, 8 * 60 * 1_000),
      })),
    ),
  );

  static test(overrides: Partial<ZenithServerConfigService> = {}) {
    return Layer.succeed(ZenithServerConfig, {
      host: "127.0.0.1",
      port: 0,
      clientDirectory: resolve(process.cwd(), "dist/client"),
      runtimeDirectory: resolve(process.cwd(), ".zenith-runtime-test"),
      tlsCertificatePath: "",
      tlsPrivateKeyPath: "",
      runwayApiSecret: "",
      runwayApiBase: "https://example.invalid",
      runwayApiVersion: "test",
      runwayPollIntervalMs: 1,
      runwayPollTimeoutMs: 100,
      ...overrides,
    });
  }
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
