// Solana Token Safety Checker — client-side, no backend.
// Data: Solana RPC (getAccountInfo for authorities) + Jupiter datapi (metadata, holders, verification).
// Honest scope: structural authority check, NOT a full audit or financial advice.

"use strict";

const RPC = "https://solana-rpc.publicnode.com";
const JUP = "https://datapi.jup.ag/v1/assets/search?query=";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const $ = (id) => document.getElementById(id);
const out = $("out");

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw Object.assign(new Error(json.error.message), { rpcCode: json.error.code });
  return json.result;
}

async function fetchMeta(mint) {
  // Best-effort metadata. Never throws — returns null on any failure.
  try {
    const res = await fetch(JUP + encodeURIComponent(mint));
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr)) return null;
    return arr.find((t) => t.id === mint) || arr[0] || null;
  } catch {
    return null;
  }
}

function deriveHolders(meta) {
  // Pull from Jupiter's audit data — reliable, no RPC rate limit.
  if (!meta || !meta.audit || typeof meta.audit.topHoldersPercentage !== "number") return null;
  return { pct: meta.audit.topHoldersPercentage, count: meta.holderCount || 0 };
}

function scoreAuthority(label, authority) {
  // Revoked (null) = safe. Present = the dev retains control.
  if (authority === null) {
    return { state: "ok", icon: "✓", title: `${label} revoked`,
      desc: `No one can ${label === "Mint authority" ? "create new tokens" : "freeze your account"}. Good.` };
  }
  return {
    state: "bad", icon: "!", title: `${label} is ACTIVE`,
    desc: label === "Mint authority"
      ? `The dev can mint unlimited new tokens and dilute supply to zero. Held by <code>${authority}</code>`
      : `The dev can freeze your wallet so you can never sell. Held by <code>${authority}</code>`,
  };
}

function scoreHolders(holders) {
  if (!holders) {
    return { state: "info", icon: "?", title: "Holder concentration: unavailable",
      desc: "Couldn't load holder data right now. Check the top holders on a block explorer." };
  }
  const p = holders.pct;
  const who = holders.count ? ` across ${holders.count.toLocaleString("en-US")} holders` : "";
  let state, desc;
  if (p < 25) { state = "ok"; desc = `Top 10 hold ${p.toFixed(1)}%${who} — well distributed.`; }
  else if (p < 60) { state = "warn"; desc = `Top 10 hold ${p.toFixed(1)}%${who} — moderately concentrated.`; }
  else { state = "bad"; desc = `Top 10 hold ${p.toFixed(1)}%${who} — whale-dominated, dump risk.`; }
  return { state, icon: state === "ok" ? "✓" : state === "warn" ? "~" : "!",
    title: "Holder concentration", desc };
}

function scoreVerified(verified, meta) {
  if (verified) {
    const tags = ((meta && meta.tags) || []).filter((t) => t !== "verified").slice(0, 3);
    return { state: "ok", icon: "✓", title: "Listed & verified on Jupiter",
      desc: `A recognized asset${tags.length ? ` (tags: <code>${tags.join(", ")}</code>)` : ""}, not anonymous.` };
  }
  return { state: "info", icon: "i", title: "Not on Jupiter's verified list",
    desc: "No verification tag yet. Common for new tokens — not proof of danger, but verify the project yourself." };
}

function scoreProgram(program, extensions) {
  if (program === "spl-token-2022") {
    const risky = ["transferFeeConfig", "transferHook", "permanentDelegate", "nonTransferable"];
    const found = (extensions || []).map((e) => e.extension).filter((e) => risky.includes(e));
    if (found.length) {
      return { state: "warn", icon: "~", title: "Token-2022 with active extensions",
        desc: `Has: <code>${found.join(", ")}</code>. These can tax, block, or seize transfers.` };
    }
    return { state: "info", icon: "i", title: "Token-2022 standard",
      desc: "Uses the newer token program. No risky extensions detected." };
  }
  return { state: "ok", icon: "✓", title: "Standard SPL token",
    desc: "Uses the classic, well-understood SPL Token program." };
}

function computeVerdict(checks, verified) {
  // Authority checks dominate. But a Jupiter-verified asset (USDC, etc.) with active
  // authorities is centralized BY DESIGN, not a rug — frame it honestly, don't cry wolf.
  const mint = checks.find((c) => c.key === "mint");
  const freeze = checks.find((c) => c.key === "freeze");
  const warn = checks.filter((c) => c.state === "warn").length;

  if (verified && (mint.state === "bad" || freeze.state === "bad")) {
    return { cls: "caution", label: "Verified · Centralized", score: "7/10",
      reason: "A recognized, verified token, but the issuer keeps mint/freeze control. That's normal for stablecoins and CEX tokens — trust the issuer, not trustless code." };
  }
  if (mint.state === "bad") {
    return { cls: "stop", label: "High Risk", score: "2/10",
      reason: "Unverified token with an active mint authority — the dev can inflate supply and crater the price at will." };
  }
  if (freeze.state === "bad") {
    return { cls: "stop", label: "High Risk", score: "4/10",
      reason: "Unverified token with an active freeze authority — the dev can freeze your wallet and trap your tokens." };
  }
  if (warn >= 1) {
    return { cls: "caution", label: "Caution", score: "6/10",
      reason: "Core authorities look revoked, but some signals need a closer look before you trust it." };
  }
  return { cls: "go", label: "Looks Clean", score: "9/10",
    reason: "Mint and freeze authorities are revoked. No structural rug levers found. Still DYOR." };
}

function render(mint, info, meta, holders) {
  const parsed = info.data.parsed.info;
  const program = info.data.program; // "spl-token" | "spl-token-2022"
  const decimals = parsed.decimals;
  const supplyUi = Number(parsed.supply) / Math.pow(10, decimals);

  const verified = !!(meta && meta.isVerified);
  const checks = [
    { key: "mint", ...scoreAuthority("Mint authority", parsed.mintAuthority ?? null) },
    { key: "freeze", ...scoreAuthority("Freeze authority", parsed.freezeAuthority ?? null) },
    { key: "verified", ...scoreVerified(verified, meta) },
    { key: "program", ...scoreProgram(program, parsed.extensions) },
    { key: "holders", ...scoreHolders(holders) },
  ];

  const v = computeVerdict(checks, verified);
  const name = (meta && meta.name) || "Unknown Token";
  const sym = (meta && meta.symbol) || "—";
  const icon = meta && meta.icon;
  const initial = (sym && sym !== "—" ? sym[0] : name[0] || "?").toUpperCase();

  const supplyStr = supplyUi.toLocaleString("en-US", { maximumFractionDigits: 0 });

  out.innerHTML = `
    <div class="result">
      <div class="identity">
        ${icon ? `<img src="${icon}" alt="${esc(name)}" onerror="this.outerHTML='<div class=\\'ph\\'>${initial}</div>'">`
                : `<div class="ph">${initial}</div>`}
        <div>
          <div class="name">${esc(name)}</div>
          <div class="sym">${esc(sym)} · supply ${supplyStr} · ${decimals} decimals</div>
          <div class="mint">${esc(mint)}</div>
        </div>
      </div>
      <div class="verdict ${v.cls}">
        <div class="label">${v.label}</div>
        <div class="score">${v.score}</div>
        <div class="reason">${v.reason}</div>
      </div>
      <div class="checks">
        ${checks.map((c) => `
          <div class="check ${c.state}">
            <div class="ic">${c.icon}</div>
            <div class="body"><div class="t">${c.title}</div><div class="d">${c.desc}</div></div>
          </div>`).join("")}
      </div>
    </div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function scan(mint) {
  mint = (mint || "").trim();
  if (!mint) return;
  if (!BASE58.test(mint)) {
    out.innerHTML = `<div class="msg err">That doesn't look like a valid Solana address. Check for typos or extra spaces.</div>`;
    return;
  }
  $("scan").disabled = true;
  out.innerHTML = `<div class="msg loading"><span class="spinner"></span>Reading on-chain data…</div>`;

  try {
    const info = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
    if (!info || !info.value) {
      out.innerHTML = `<div class="msg err">No account found at this address on mainnet. It may not exist, or it's an account (not a token mint).</div>`;
      return;
    }
    const prog = info.value.data && info.value.data.program;
    if (prog !== "spl-token" && prog !== "spl-token-2022") {
      out.innerHTML = `<div class="msg err">This address is owned by <code>${esc(info.value.owner)}</code> — it's not an SPL token mint. Paste a token's mint address.</div>`;
      return;
    }
    const parsed = info.value.data.parsed;
    if (parsed.type !== "mint") {
      out.innerHTML = `<div class="msg err">This is a token <b>${esc(parsed.type)}</b> account, not a mint. Paste the mint address instead.</div>`;
      return;
    }
    const meta = await fetchMeta(mint);
    const holders = deriveHolders(meta);
    render(mint, info.value, meta, holders);
  } catch (e) {
    const m = e.rpcCode === 429
      ? "Solana's public RPC is rate-limiting right now. Wait a few seconds and try again."
      : `Could not complete the scan: ${esc(e.message || "network error")}`;
    out.innerHTML = `<div class="msg err">${m}</div>`;
  } finally {
    $("scan").disabled = false;
  }
}

$("scan").addEventListener("click", () => scan($("addr").value));
$("addr").addEventListener("keydown", (e) => { if (e.key === "Enter") scan($("addr").value); });
document.querySelectorAll(".examples button").forEach((b) =>
  b.addEventListener("click", () => { $("addr").value = b.dataset.mint; scan(b.dataset.mint); }));
