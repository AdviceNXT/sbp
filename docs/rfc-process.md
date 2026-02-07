# SBP RFC Process

## Purpose

SBP uses a lightweight Request for Comments (RFC) process for proposing significant changes to the protocol specification. This ensures that breaking changes, new operations, and architectural decisions receive community input before implementation.

## When is an RFC Required?

An RFC is REQUIRED for:
- New protocol operations (new JSON-RPC methods)
- Changes to the wire protocol or message format
- New decay models or condition types
- Breaking changes to existing behavior
- New security requirements

An RFC is NOT required for:
- Bug fixes in implementations
- Documentation improvements
- New examples or tutorials
- Internal implementation changes that don't affect the protocol

## RFC Lifecycle

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  DRAFT   │────▶│  REVIEW  │────▶│ ACCEPTED │────▶│  MERGED  │
│          │     │          │     │          │     │          │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                      │                                  │
                      ▼                                  ▼
                 ┌──────────┐                      ┌──────────┐
                 │ REJECTED │                      │SUPERSEDED│
                 └──────────┘                      └──────────┘
```

| Status | Description |
|--------|-------------|
| **Draft** | Initial proposal, open for early feedback |
| **Review** | Actively seeking community review (minimum 14 days) |
| **Accepted** | Approved by maintainers, awaiting implementation |
| **Merged** | Implemented and merged into the specification |
| **Rejected** | Not accepted (with documented rationale) |
| **Superseded** | Replaced by a newer RFC |

## How to Submit an RFC

1. Copy `rfcs/0000-template.md` to `rfcs/XXXX-descriptive-name.md`
2. Fill in the template sections
3. Open a pull request with the prefix `[RFC]`
4. The RFC enters **Draft** status
5. After initial feedback, the author moves it to **Review**
6. Maintainers will schedule a 14-day review period
7. After review, the RFC is **Accepted** or **Rejected**

## Decision Making

- Maintainers have final decision authority
- Community consensus is strongly preferred
- All rejected RFCs include written rationale
- Accepted RFCs are assigned to a version milestone
