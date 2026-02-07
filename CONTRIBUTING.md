# Contributing to SBP

Thank you for your interest in contributing to the Stigmergic Blackboard Protocol!

## Development Setup

```bash
# Clone the repo
git clone https://github.com/sbp-protocol/sbp.git
cd sbp

# Install all dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test
```

### Python Client

```bash
cd packages/client-python
pip install -e ".[dev]"
pytest
```

## Project Structure

```
sbp/
├── packages/
│   ├── server/          # @advicenxt/sbp-server - TypeScript server
│   ├── client-ts/       # @advicenxt/sbp-client - TypeScript client
│   └── client-python/   # sbp-client - Python client
├── schemas/             # JSON Schema
└── SPECIFICATION.md     # Protocol specification
```

## Making Changes

1. **Fork** the repository
2. **Create a branch** for your feature (`git checkout -b feature/amazing-feature`)
3. **Make your changes**
4. **Run tests** to ensure nothing is broken
5. **Commit** with a clear message
6. **Push** to your fork
7. **Open a Pull Request**

## Pull Request Guidelines

- Keep PRs focused on a single change
- Update documentation if needed
- Add tests for new functionality
- Follow existing code style

## Specification Changes

Changes to `SPECIFICATION.md` require discussion first. Please open an issue to propose changes before submitting a PR.

## Code of Conduct

Be respectful and constructive. We're all here to build something useful.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
