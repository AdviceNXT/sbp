# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.1   | :white_check_mark: |
| < 0.2.1 | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability within SBP, please report it responsibly.

### How to Report

1. **Email:** Send a detailed report to **contact@vaalmi.com**
2. **Include:**
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

SBP is a reference project maintained on a best-effort basis, so there is no guaranteed response time. We read every report, and will tell you what we decide to do about it.

- **Credit** in the security advisory (unless you prefer anonymity)

### Please Do NOT

- Open a public GitHub issue for security vulnerabilities
- Exploit the vulnerability beyond what is necessary to demonstrate it
- Share the vulnerability with others before it is fixed

## Security Best Practices for Deployers

SBP is a reference implementation. If you deploy the server anyway:

1. **Always enable authentication** — Use `--api-key` or the `SBP_API_KEYS` environment variable
2. **Use TLS termination** — Deploy behind a reverse proxy (nginx, Caddy) with HTTPS
3. **Enable rate limiting** — Use `--rate-limit` to prevent abuse
4. **Restrict network access** — Bind to `localhost` unless external access is required
5. **Monitor resource usage** — SSE connections consume server resources; set appropriate limits
6. **Validate payloads** — The server validates input via Zod schemas, but consider additional payload size limits at the proxy level
7. **Trust every client you give access to** — The server holds its state in memory and doesn't bound all of it, so a client that can write can use up memory
8. **Leave `cors` off unless you need it** — When on, it lets a web page on any origin call the server

The official SDKs can't send an API key yet, so they can't connect to a server that requires one.

## Scope

This security policy applies to:

- The SBP protocol specification
- The reference server implementation (`@advicenxt/sbp-server`)
- The official client SDKs (`@advicenxt/sbp-client`, `sbp-client`)
