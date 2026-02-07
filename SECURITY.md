# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability within SBP, please report it responsibly.

### How to Report

1. **Email:** Send a detailed report to **security@sbp.dev**
2. **Include:**
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment** within 48 hours of your report
- **Assessment** within 1 week
- **Fix timeline** communicated after assessment
- **Credit** in the security advisory (unless you prefer anonymity)

### Please Do NOT

- Open a public GitHub issue for security vulnerabilities
- Exploit the vulnerability beyond what is necessary to demonstrate it
- Share the vulnerability with others before it is fixed

## Security Best Practices for Deployers

When deploying an SBP server in production:

1. **Always enable authentication** — Use `--api-key` or the `SBP_API_KEYS` environment variable
2. **Use TLS termination** — Deploy behind a reverse proxy (nginx, Caddy) with HTTPS
3. **Enable rate limiting** — Use `--rate-limit` to prevent abuse
4. **Restrict network access** — Bind to `localhost` unless external access is required
5. **Monitor resource usage** — SSE connections consume server resources; set appropriate limits
6. **Validate payloads** — The server validates input via Zod schemas, but consider additional payload size limits at the proxy level

## Scope

This security policy applies to:

- The SBP protocol specification
- The reference server implementation (`@advicenxt/sbp-server`)
- The official client SDKs (`@advicenxt/sbp-client`, `sbp-client`)
