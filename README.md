# AgentVault

**Give AI agents money. Not unlimited control.**

A policy-controlled USDC smart wallet for autonomous AI agents, built on [Arc](https://docs.arc.io).

> **AI proposes. Code disposes.**

---

## The idea

AI agents should have economic agency without unrestricted financial authority.

A human operator funds a vault and defines a spending policy **on chain**. An AI agent
gets a *restricted session key* and can **request** payments. The `AgentVault` contract
independently decides whether each one is permitted.

The language model is never the security boungit dary. Compromising the AI, its prompt, its
process and its private key — all at once — still cannot move more USDC than the human
authorised, to anyone the human did not name, after the human's deadline, or once the
human pressed revoke.

### Enforced on chain, per session

| Rule | Effect |
|---|---|
| `maxPerTx` | Ceiling on any single payment |
| `dailyLimit` | Ceiling on cumulative spend per UTC day |
| `expiresAt` | Session fails closed, no operator action needed |
| Recipient allowlist | Only addresses the operator named can be paid |
| `revoked` | Operator kill switch — permanent |

---

## Status

Foundation complete. The enforcement layer is written and tested; the UI and agent
runtime are scaffolded with their responsibilities documented in place.

- [x] Monorepo, TypeScript, Next.js, Tailwind v4, Foundry
- [x] `AgentVault` + `AgentVaultFactory` — **71 tests, 100% branch coverage**
- [x] Shared types, USDC decimal safety, env validation, generated ABIs
- [x] Agent runtime: registry, payment tool, Claude tool-calling loop
- [x] Paid demo services (Weather, Research) with on-chain payment verification
- [x] Operator console: Overview, Agent, Policy, Activity, Services
- [ ] **Deploy to Arc testnet, then mainnet** — nothing is deployed yet
- [ ] End-to-end run against a live vault

Full design, threat model and build plan: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**

---

## Quick start

Requires Node 20+, [pnpm](https://pnpm.io), and [Foundry](https://getfoundry.sh).

```bash
# forge-std is a git submodule — a plain clone will not build without this
git submodule update --init --recursive

pnpm install

# contracts
pnpm contracts:build
pnpm contracts:test
pnpm abi:sync          # regenerate TS ABIs from the build artifacts

# config — fill in before running anything that touches a network
cp .env.example apps/web/.env.local
cp .env.example contracts/.env

# three processes: console, agent runtime, paid services
pnpm dev:web      # http://localhost:3000
pnpm dev:agent    # http://localhost:8787  (holds the session key)
pnpm dev:service  # http://localhost:8788
```

### Checks

```bash
pnpm test                       # 26 TypeScript tests
pnpm typecheck                  # all four packages
pnpm contracts:test             # 71 Foundry tests
pnpm --filter @agentvault/web lint
pnpm --filter @agentvault/web build
```

### Deploying

```bash
cd contracts
forge script script/Deploy.s.sol \
  --rpc-url "$ARC_RPC_URL" --broadcast --account deployer
```

`Deploy.s.sol` asserts `block.chainid == EXPECTED_CHAIN_ID` and refuses to broadcast on a
mismatch. Arc mainnet is `5042`; testnet is `5042002`. Deploy to testnet first.

---

## Repository layout

```
contracts/          Foundry — the enforcement layer (the only security authority)
packages/shared/    Types, USDC decimals, chain config, revert decoding, ABIs
apps/web/           Next.js operator console (Overview/Agent/Policy/Activity/Services)
apps/agent/         Claude tool-calling runtime — untrusted by design, holds the session key
apps/service/       Paid demo services; verify payments on chain themselves
docs/               Architecture and threat model
```

---

## Two things Arc changes

**USDC is the gas token, in two representations.** Native USDC has **18 decimals** and
pays for gas; the ERC-20 interface at `0x3600…0000` has **6 decimals** and is what moves
between accounts. Mixing them is a 10¹² error. AgentVault accounts exclusively in the
6-decimal ERC-20 representation, and every conversion goes through one audited module
(`packages/shared/src/usdc.ts`). The env loader rejects `USDC_DECIMALS=18` outright.

**Arc targets the Prague hardfork** and finalises deterministically. So `foundry.toml`
pins `evm_version = "prague"` rather than Foundry's `osaka` default, and the payment
verifier waits exactly one confirmation — not a shortcut, just the absence of
probabilistic reorg risk.

---

## Scope, stated plainly

This is **not** an ERC-4337 implementation and does not claim to be. The MVP's authority
model is a restricted EOA session key. `IAgentVault.payWithIntent` is declared and
reverts `NotImplemented`; the migration path is EIP-712 signed intents behind a relayer,
then a 4337 validator — none of which changes the policy logic, the events, or the
frontend.

Also out of scope: multi-token support, recurring allowances, upgradeability, multi-sig
owners. None are needed to demonstrate the thesis, and each would add authority the
design is trying to remove.

The contracts are unaudited hackathon code. Fund the mainnet demo accordingly.

---

## Three separate identities

| | Holds | Can |
|---|---|---|
| **Operator wallet** | The owner key, in the browser | Change policy, move funds |
| **Vault** | The USDC | Nothing on its own — it only enforces |
| **Session signer** | A restricted key, server-side only | Call `pay`, within policy |

The session key never reaches the browser and never enters the model's context.
No `NEXT_PUBLIC_` variable in this project carries a secret.

## License

MIT
