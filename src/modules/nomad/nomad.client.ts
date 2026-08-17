import { readFileSync } from "node:fs";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { AppError } from "../../common/errors/app-error";
import type { NomadAllocation, NomadEvaluation, NomadNode } from "./nomad.types";

export interface NomadClientConfig {
  baseUrl: string;
  token?: string;
  requestTimeoutMs: number;
  tlsRejectUnauthorized?: boolean;
  tlsCaFile?: string;
}

export class NomadClient {
  private readonly tlsCa?: Buffer;

  constructor(private readonly config: NomadClientConfig) {
    if (config.tlsCaFile) {
      try {
        this.tlsCa = readFileSync(config.tlsCaFile);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown CA file error";
        throw new Error(`Failed to read NOMAD_TLS_CA_FILE: ${message}`);
      }
    }
  }

  getNodes(): Promise<NomadNode[]> {
    return this.get<NomadNode[]>("/v1/nodes");
  }

  getNode(nodeId: string): Promise<NomadNode> {
    return this.get<NomadNode>(`/v1/node/${encodeURIComponent(nodeId)}`);
  }

  getAllocations(): Promise<NomadAllocation[]> {
    return this.get<NomadAllocation[]>("/v1/allocations", {
      namespace: "*",
      task_states: "false"
    });
  }

  getFailedAllocations(): Promise<NomadAllocation[]> {
    return this.get<NomadAllocation[]>("/v1/allocations", {
      namespace: "*",
      task_states: "false",
      filter: 'ClientStatus=="failed"'
    });
  }

  getAllocation(allocationId: string): Promise<NomadAllocation> {
    return this.get<NomadAllocation>(`/v1/allocation/${encodeURIComponent(allocationId)}`);
  }

  getJobSummary(jobId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(`/v1/job/${encodeURIComponent(jobId)}/summary`);
  }

  getBlockedEvaluations(): Promise<NomadEvaluation[]> {
    return this.get<NomadEvaluation[]>("/v1/evaluations", {
      filter: 'Status=="blocked"'
    });
  }

  private async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = this.buildUrl(path, query);
    const headers: Record<string, string> = {
      accept: "application/json",
      "accept-encoding": "identity"
    };
    if (this.config.token) headers["X-Nomad-Token"] = this.config.token;

    return await new Promise<T>((resolve, reject) => {
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
        void this.readResponse<T>(url, response).then(
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
            "NOMAD_TIMEOUT",
            `Nomad GET ${url.pathname}${url.search} timed out: ${message}`
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
        "NOMAD_CONFIG_INVALID",
        "NOMAD_BASE_URL must be a valid URL including http:// or https://."
      );
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new AppError(
        500,
        "NOMAD_CONFIG_INVALID",
        `Unsupported NOMAD_BASE_URL protocol: ${url.protocol}`
      );
    }

    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    return url;
  }

  private async readResponse<T>(url: URL, response: IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];
    for await (const chunk of response) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const body = Buffer.concat(chunks).toString("utf8");
    const status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      throw new AppError(
        502,
        "NOMAD_UPSTREAM_ERROR",
        `Nomad GET ${url.pathname}${url.search} returned HTTP ${status}${body ? `: ${body.slice(0, 300)}` : ""}`
      );
    }

    try {
      return JSON.parse(body) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      throw new AppError(
        502,
        "NOMAD_INVALID_RESPONSE",
        `Nomad GET ${url.pathname}${url.search} returned invalid JSON: ${message}`
      );
    }
  }

  private transportError(url: URL, error: unknown): AppError {
    return new AppError(
      502,
      "NOMAD_UNREACHABLE",
      `Nomad GET ${url.pathname}${url.search} failed: ${this.formatTransportError(error)}`
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
