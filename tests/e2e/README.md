# NorthVault E2E tests

Playwright smoke + authenticated tests. Local dev runs against `npm run dev`;
CI can run against the live preview deployment via Microsoft Playwright Testing.

## Run locally

```bash
# Install browsers once
npx playwright install --with-deps chromium

# Smoke only (no auth needed)
npm run test:e2e -- smoke.spec.ts

# Full suite (requires test user)
E2E_USER_EMAIL=e2e@northvault.test \
E2E_USER_PASSWORD='...' \
npm run test:e2e
```

## Run on Microsoft Playwright Testing (Azure)

```bash
PLAYWRIGHT_SERVICE_URL='wss://<region>.api.playwright-test.io/...' \
PLAYWRIGHT_SERVICE_ACCESS_TOKEN=$(bws secret get PLAYWRIGHT_SERVICE_ACCESS_TOKEN) \
PLAYWRIGHT_BASE_URL='https://north-vault.vercel.app' \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
npm run test:e2e:cloud
```

## What's tested

- `smoke.spec.ts`: public routes render, auth gate redirects work
- `authenticated.spec.ts`: login → library → search → people → upload

## Adding new tests

Use `data-testid` on critical elements rather than text selectors when
possible — test stability matters more than brevity. Group related tests
with `test.describe()` and prefer hooks (`beforeEach`) for shared setup.

## Test user creation

In Supabase dashboard → Authentication → Users → Add User, create
`e2e@northvault.test` with a strong password. Set role to `admin` via
the trigger `northvault.handle_new_user` (insert raw_user_meta_data
`{"role":"admin"}`). Store the password in BWS as `E2E_USER_PASSWORD`.
