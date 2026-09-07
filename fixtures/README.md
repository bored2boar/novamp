# fixtures

What `--demo` reads.

Every file in `clusters/` carries an `origin` field, and the demo banner repeats
whatever it says:

- **`synthetic`** - shaped by hand in `scripts/make-fixtures.ts` to exercise
  every branch of the verdict logic. Not a recording of anything. This is what
  ships in the repository.
- **`capture`** - written by `scripts/capture-fixtures.ts` from a real read of
  Robinhood Chain, with the block it was taken at.

The distinction matters more than it looks. A tool that shows you a beautiful
table built from numbers it invented is a screenshot generator, so novamp says
which one it is on every single run rather than in a footnote.

## Replacing the synthetic set with real launches

```sh
cp .env.example .env          # point RPC_URL at an endpoint you trust
npx tsx scripts/capture-fixtures.ts --busiest 3
```

That writes the three most contested names in the current window, with holders,
early buyers and deployer funding already read, so `--demo` runs offline
afterwards. Or capture one fight by name:

```sh
npx tsx scripts/capture-fixtures.ts PEANUT
```

## Regenerating the synthetic set

```sh
npx tsx scripts/make-fixtures.ts
```

Deterministic: the same seed produces the same file, so regenerating does not
churn the diff.

## smart-wallets.json

The proven-wallet registry. The shipped one is synthetic and matches the buyers
in the synthetic clusters, so convergence has something to find in demo mode.
Rebuild it from real history with `novamp smart build`. See
[../docs/SMART-WALLETS.md](../docs/SMART-WALLETS.md) for what qualifies a wallet
and why the method is weaker than it looks.
