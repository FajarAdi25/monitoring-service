import { isIP } from "node:net";
import tls from "node:tls";

export interface SslCertificateInfo {
  validFrom: Date;
  expiresAt: Date;
  subjectCn: string | null;
  issuerCn: string | null;
  fingerprint256: string | null;
}

export class SslCertificateClient {
  constructor(private readonly timeoutMs: number) {}

  inspect(endpoint: string): Promise<SslCertificateInfo> {
    const target = new URL(endpoint);
    if (target.protocol !== "https:") {
      throw new Error(`SSL monitoring requires an https URL: ${endpoint}`);
    }

    const host = target.hostname;
    const port = target.port ? Number(target.port) : 443;

    return new Promise((resolve, reject) => {
      const socket = tls.connect({
        host,
        port,
        rejectUnauthorized: false,
        ...(isIP(host) === 0 ? { servername: host } : {})
      });

      let settled = false;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(error);
      };

      socket.setTimeout(this.timeoutMs, () => {
        fail(new Error(`TLS certificate inspection timed out after ${this.timeoutMs}ms`));
      });

      socket.once("error", fail);
      socket.once("secureConnect", () => {
        if (settled) return;

        const certificate = socket.getPeerCertificate();
        if (!certificate || !certificate.valid_to || !certificate.valid_from) {
          fail(new Error(`No usable TLS peer certificate returned by ${endpoint}`));
          return;
        }

        const expiresAt = new Date(certificate.valid_to);
        const validFrom = new Date(certificate.valid_from);
        if (Number.isNaN(expiresAt.getTime()) || Number.isNaN(validFrom.getTime())) {
          fail(new Error(`Invalid TLS certificate validity date returned by ${endpoint}`));
          return;
        }

        settled = true;
        socket.end();
        resolve({
          validFrom,
          expiresAt,
          subjectCn: certificate.subject?.CN ?? null,
          issuerCn: certificate.issuer?.CN ?? null,
          fingerprint256: certificate.fingerprint256 ?? null
        });
      });
    });
  }
}
