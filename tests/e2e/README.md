[中文](README.zh-CN.md) | **English**

# Sparo OS E2E Tests

E2E test framework using WebDriverIO + the embedded Sparo OS WebDriver.

> For complete documentation, see [E2E-TESTING-GUIDE.md](E2E-TESTING-GUIDE.md)

## Quick Start

### 1. Install Dependencies

```bash
# Build the debug app
cargo build -p sparo-desktop

# Install test dependencies
cd tests/e2e && pnpm install
```

`sparo-desktop` is the current technical Cargo package name for the Sparo OS desktop app.

### 2. Run Tests

```bash
cd tests/e2e

# L0 smoke tests (fastest)
pnpm run test:l0
pnpm run test:l0:all

# L1 functional tests
pnpm run test:l1

# Run all tests
pnpm test
```

## Test Levels

| Level | Purpose | Run Time | AI Required |
|-------|---------|----------|-------------|
| L0 | Smoke tests - verify basic functionality | < 1 min | No |
| L1 | Functional tests - validate features | 5-15 min | No (mocked) |
| L2 | Integration tests - full system validation | 15-60 min | Yes |

## Directory Structure

```
tests/e2e/
├── specs/           # Test specifications
├── page-objects/    # Page Object Model
├── helpers/         # Utility functions
├── fixtures/        # Test data
└── config/          # Configuration
```

## Troubleshooting

### Embedded WebDriver not ready

The test runner starts Sparo OS directly and waits for the embedded WebDriver service on `127.0.0.1:4445`.

### App not built

```bash
cargo build -p sparo-desktop
```

### Test timeout

Debug builds are slower. Adjust timeouts in config if needed.

## More Information

- [Complete Testing Guide](E2E-TESTING-GUIDE.md) - Test writing guidelines, best practices, test plan
- [Sparo OS Project Structure](../../AGENTS.md)
