import { readFileSync } from "node:fs";
import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import https from "node:https";
import { AppError } from "../../common/errors/app-error";
import type {
  ConsulAutopilotHealth,
  ConsulHealthCheck,
  ConsulHealthChecksResult,
  ConsulHealthState
} from "./consul.types";

export interface ConsulClientConfig {
  baseUrl: string;
  token?: string;
  requestTimeoutMs: number;
  tlsRejectUnauthorized?: boolean;
  tlsCaFile?: string;
}

interface ConsulGetOptions {
  /** Non-2xx statuses whose body is still a valid response (autopilot health returns 429 when unhealthy). */
  acceptStatuses?: number[];
}

interface ConsulRawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

export class ConsulClient {
  private readonly tlsCa?: Buffer;

  constructor(private readonly config: ConsulClientConfig) {
    if (config.tlsCaFile) {
      try {
        this.tlsCa = readFileSync(config.tlsCaFile);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown CA file error";
        throw new Error(`Failed to read CONSUL_TLS_CA_FILE: ${message}`);
      }
    }
  }

  async getDatacenters(): Promise<string[]> {
    const response = await this.get("/v1/catalog/datacenters");
    return this.parseJson<string[]>(response, "/v1/catalog/datacenters");
  }

  async getLeader(datacenter?: string): Promise<string> {
    const path = "/v1/status/leader";
    const response = await this.get(path, this.dcQuery(datacenter), { acceptStatuses: [500] });
    // Consul answers 500 "No cluster leader" when the datacenter has no leader.
    if (response.status === 500) {
      if (/no cluster leader/i.test(response.body)) return "";
      throw this.upstreamError(path, response);
    }
    const leader = this.parseJson<unknown>(response, path);
    return typeof leader === "string" ? leader : "";
  }

  async getHealthChecks(state: ConsulHealthState, datacenter?: string): Promise<ConsulHealthChecksResult> {
    const path = `/v1/health/state/${encodeURIComponent(state)}`;
    // stale: any server answers, so checks are still read when there is no leader.
    const response = await this.get(path, { ...this.dcQuery(datacenter), stale: "" });
    const knownLeader = this.headerValue(response.headers, "x-consul-knownleader");
    return {
      checks: this.parseJson<ConsulHealthCheck[]>(response, path),
      knownLeader: knownLeader === undefined ? null : knownLeader.toLowerCase() === "true"
    };
  }

  async getAutopilotHealth(datacenter?: string): Promise<ConsulAutopilotHealth> {
    const path = "/v1/operator/autopilot/health";
    const response = await this.get(path, this.dcQuery(datacenter), { acceptStatuses: [429] });
    return this.parseJson<ConsulAutopilotHealth>(response, path);
  }

  private dcQuery(datacenter?: string): Record<string, string> {
    return datacenter ? { dc: datacenter } : {};
  }

  private headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  private async get(
    path: string,
    query?: Record<string, string>,
    options: ConsulGetOptions = {}
  ): Promise<ConsulRawResponse> {
    const url = this.buildUrl(path, query);
    const headers: Record<string, string> = {
      accept: "application/json",
      "accept-encoding": "identity"
    };
    if (this.config.token) headers["X-Consul-Token"] = this.config.token;

    return await new Promise<ConsulRawResponse>((resolve, reject) => {
      const requestOptions: https.RequestOptions = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers
      };

      if (url.protocol === "https:") {
        requestOptions.rejectUnauthorized = this.config.tlsRejectUnauthorized ?? true;
        if (this.tlsCa) requestOptions.ca = this.tlsCa;
      }

      const onResponse = (response: IncomingMessage): void => {
        void this.readResponse(url, response, options).then(
          resolve,
          error => {
            if (error instanceof AppError) {
              reject(error);
              return;
            }
            reject(this.transportError(url, error));
          }
        );
      };

      const request = url.protocol === "https:"
        ? https.request(requestOptions, onResponse)
        : http.request(requestOptions, onResponse);

      request.setTimeout(this.config.requestTimeoutMs, () => {
        const timeoutError = new Error(`request timed out after ${this.config.requestTimeoutMs}ms`);
        Object.assign(timeoutError, { code: "ETIMEDOUT" });
        request.destroy(timeoutError);
      });

      request.on("error", error => {
        const code = this.errorCode(error);
        const message = this.formatTransportError(error);
        if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
          reject(new AppError(
            504,
            "CONSUL_TIMEOUT",
            `Consul GET ${url.pathname}${url.search} timed out: ${message}`
          ));
          return;
        }

        reject(this.transportError(url, error));
      });

      request.end();
    });
  }

  private buildUrl(path: string, query?: Record<string, string>): URL {
    const base = this.config.baseUrl.endsWith("/")
      ? this.config.baseUrl.slice(0, -1)
      : this.config.baseUrl;

    let url: URL;
    try {
      url = new URL(`${base}${path}`);
    } catch {
      throw new AppError(
        500,
        "CONSUL_CONFIG_INVALID",
        "Consul cluster URL must be a valid URL including http:// or https://."
      );
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new AppError(
        500,
        "CONSUL_CONFIG_INVALID",
        `Unsupported Consul cluster URL protocol: ${url.protocol}`
      );
    }

    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    return url;
  }

  private async readResponse(
    url: URL,
    response: IncomingMessage,
    options: ConsulGetOptions
  ): Promise<ConsulRawResponse> {
    const chunks: Buffer[] = [];
    for await (const chunk of response) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const raw: ConsulRawResponse = {
      status: response.statusCode ?? 0,
      headers: response.headers,
      body: Buffer.concat(chunks).toString("utf8")
    };

    const accepted = options.acceptStatuses?.includes(raw.status) ?? false;
    if (!accepted && (raw.status < 200 || raw.status >= 300)) {
      throw this.upstreamError(`${url.pathname}${url.search}`, raw);
    }
    return raw;
  }

  private parseJson<T>(response: ConsulRawResponse, path: string): T {
    try {
      return JSON.parse(response.body) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      throw new AppError(
        502,
        "CONSUL_INVALID_RESPONSE",
        `Consul GET ${path} returned invalid JSON: ${message}`
      );
    }
  }

  private upstreamError(path: string, response: ConsulRawResponse): AppError {
    return new AppError(
      502,
      "CONSUL_UPSTREAM_ERROR",
      `Consul GET ${path} returned HTTP ${response.status}${response.body ? `: ${response.body.slice(0, 300)}` : ""}`
    );
  }

  private transportError(url: URL, error: unknown): AppError {
    return new AppError(
      502,
      "CONSUL_UNREACHABLE",
      `Consul GET ${url.pathname}${url.search} failed: ${this.formatTransportError(error)}`
    );
  }

  private errorCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }

  private formatTransportError(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    const parts: string[] = [];
    const code = this.errorCode(error);
    if (code) parts.push(code);
    if (error.message) parts.push(error.message);

    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause && cause !== error) {
      const causeCode = this.errorCode(cause);
      const causeMessage = cause instanceof Error ? cause.message : String(cause);
      const causeText = [causeCode, causeMessage].filter(Boolean).join(" ");
      if (causeText && !parts.includes(causeText)) parts.push(`cause=${causeText}`);
    }

    return parts.join(" ") || "Unknown transport error";
  }
}
