# Solana Token Safety Checker

Paste any Solana SPL token mint address and get an instant, on-chain read on the things that actually let a dev rug you — mint authority, freeze authority, holder concentration, and verification status.

**Live:** https://token-checker-flax.vercel.app

No wallet connection. No backend. No tracking. Your browser talks directly to Solana RPC and Jupiter — nothing is logged.

---

## Why this exists

Most "is this token safe?" advice is vibes. The actual rug levers are on-chain and checkable in seconds:

- **Mint authority active?** The dev can print unlimited new tokens and dilute your bag to zero.
- **Freeze authority active?** The dev can freeze your wallet so you can never sell.
- **Holder concentration?** A handful of wallets holding most of the supply means a dump can nuke the price.

This tool reads those directly from the chain and explains them in plain language — without asking you to connect a wallet (so there's zero approval risk just to check a token).

## What it checks

| Check | Source | Why it matters |
|-------|--------|----------------|
| Mint authority | Solana RPC (`getAccountInfo`) | Active = supply can be inflated |
| Freeze authority | Solana RPC (`getAccountInfo`) | Active = your wallet can be frozen |
| Token program | Solana RPC | Flags Token-2022 extensions (transfer fee, hook, permanent delegate) |
| Holder concentration | Jupiter datapi | Whale-dominated supply = dump risk |
| Verification | Jupiter datapi | Recognized asset vs anonymous token |

It's smart about context: a verified stablecoin like USDC keeps mint/freeze authority **by design** (the issuer needs it), so it reads "Verified · Centralized" — not a naive "High Risk." Trust the issuer, not trustless code.

## How it works

Pure client-side. One static page, one script. The browser calls:

- `solana-rpc.publicnode.com` — for the token mint account (authorities, supply, program)
- `datapi.jup.ag` — for metadata, holder stats, and verification tags

No server, no database, no API keys, nothing to maintain.

## Run locally

```bash
git clone https://github.com/daffhaidar/solana-token-checker.git
cd solana-token-checker
python3 -m http.server 8000
# open http://localhost:8000
```

## Stack

- Vanilla HTML + CSS + JavaScript (no framework, no build step)
- Solana JSON-RPC + Jupiter datapi
- Deployed on Vercel with a strict Content-Security-Policy and the usual security headers (HSTS, X-Frame-Options DENY, nosniff)

## Disclaimer

This is a **structural on-chain check, not financial advice and not a full audit.** A clean authority report does not guarantee a token is safe — a dev can still rug through other means. Always do your own research.

---

Built by [Daffa Haidar](https://haidarwrite.tech) · [GitHub](https://github.com/daffhaidar)
