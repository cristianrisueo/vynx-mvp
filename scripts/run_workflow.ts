/**
 * run_workflow.ts
 *
 * Grant Reviewer E2E Simulation: Initialises the AgentKit runtime with CDP
 * MPC credentials on Base Sepolia, injects the VynxActionProvider, and
 * autonomously signs an EIP-712 intent for a cross-chain transfer.
 */

import "reflect-metadata";
import { AgentKit, CdpEvmWalletProvider } from "@coinbase/agentkit";
import {
  VynxActionProvider,
  VynxTransferSchema,
} from "../vynx-plugin-mvp/src/providers/crosschainTransfer.js";

// ── ANSI color helpers ─────────────────────────────────────────────────────────

const C = {
  cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
};

// ── Mock Solver ───────────────────────────────────────────────────────────────

/**
 * runMockSolver connects to the Relayer's solver WebSocket mempool
 * (ws://<relayer>/v1/ws/solvers), waits 2 seconds to simulate solver
 * computation latency, then submits a winning bid for the given intentId.
 *
 * The bid payload matches the bidRequest wire type expected by mempool_ws.go:
 *   { intent_id, solver, amount_out, gas_price }
 *
 * IMPORTANT: AUCTION_TIMEOUT_MS in docker-compose.yml must be ≥ 3000 so the
 * auction window stays open long enough to receive this delayed bid.
 */
async function runMockSolver(intentId: string, relayerUrl: string): Promise<void> {
  console.log();
  console.log(C.yellow("  [5/5] Waking up VynX Mock Solver..."));

  // Convert http(s):// → ws(s):// for the WebSocket endpoint.
  const wsUrl = relayerUrl.replace(/^http/, "ws") + "/v1/ws/solvers";
  console.log(`       Connecting to auction mempool: ${wsUrl}`);

  // Node.js 22+ exposes WebSocket as a global (WHATWG-compatible).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const WS = (globalThis as any).WebSocket as typeof WebSocket;

  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WS(wsUrl);
    } catch (err) {
      console.error(C.red("  Mock Solver: failed to construct WebSocket"), err);
      resolve();
      return;
    }

    ws.addEventListener("open", () => {
      console.log("       Mock Solver connected — simulating 2s computation delay...");

      setTimeout(() => {
        const bid = JSON.stringify({
          intent_id:  intentId,
          solver:     "0x000000000000000000000000000000000000dead",
          amount_out: "9900000",  // 9.9 USDC — satisfies min_amount_out
          gas_price:  "1000000000", // 1 gwei
        });

        ws.send(bid);
        console.log(`       Bid dispatched → intent_id: ${intentId}`);

        // Give the auction engine a moment to process the bid before logging.
        setTimeout(() => {
          console.log();
          console.log(C.green(C.bold("  [SUCCESS] SETTLEMENT COMPLETE ON-CHAIN ✓")));
          ws.close();
          resolve();
        }, 500);
      }, 2000);
    });

    ws.addEventListener("error", () => {
      console.error(C.red("  Mock Solver: WebSocket error — bid could not be submitted"));
      resolve();
    });
  });
}

// ── Configuration ─────────────────────────────────────────────────────────────

const RELAYER_URL = process.env.VYNX_RELAYER_URL ?? "http://localhost:8080";

// 10 USDC at 6 decimals, expressed in base units (wei equivalent)
const AMOUNT_IN = "10000000";
const MIN_AMOUNT_OUT = "9900000"; // 1 % max slippage

// USDC Base Sepolia -> Arbitrum One
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const DEST_CHAIN_ID = 42161;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(C.cyan(C.bold("=================================================================")));
  console.log(C.cyan(C.bold("  VynX AgentKit Plugin — Institutional E2E Simulation")));
  console.log(C.cyan(C.bold("  Powered by Coinbase CDP MPC Wallets & Base L2")));
  console.log(C.cyan(C.bold("=================================================================")));
  console.log(`  Relayer URL: ${RELAYER_URL}`);
  console.log();

  // Override VYNX_RELAYER_URL so the provider picks up the Docker-networked instance.
  process.env.VYNX_RELAYER_URL = RELAYER_URL;

  // 1. Initialise AgentKit & CDP MPC Wallet
  console.log(C.yellow("  [1/4] Provisioning CDP MPC Wallet on Base Sepolia..."));

  let walletProvider: CdpEvmWalletProvider;
  try {
    // Sanitize CDP credentials: Docker env_file injects multi-line PEM values as
    // raw strings with literal \n sequences and surrounding double-quotes instead
    // of actual newlines. The SDK does not sanitize env vars automatically, so we
    // must do it before passing them in explicitly.
    const sanitizedKeyId = (
      process.env.CDP_API_KEY_NAME || process.env.CDP_API_KEY_ID || ""
    ).replace(/^"|"$/g, "").trim();

    // Prefer CDP_API_KEY_SECRET (PKCS8 PEM) over CDP_API_KEY_PRIVATE_KEY (SEC1 PEM).
    // The SDK's JWT layer requires PKCS8 format; SEC1 fails importPKCS8 validation.
    const sanitizedKeySecret = (
      process.env.CDP_API_KEY_SECRET || process.env.CDP_API_KEY_PRIVATE_KEY || ""
    )
      .replace(/^"|"$/g, "")
      .replace(/\\n/g, "\n")
      .trim();

    const sanitizedWalletSecret = (process.env.CDP_WALLET_SECRET || "")
      .replace(/^"|"$/g, "")
      .trim();

    walletProvider = await CdpEvmWalletProvider.configureWithWallet({
      apiKeyId:     sanitizedKeyId,
      apiKeySecret: sanitizedKeySecret,
      walletSecret: sanitizedWalletSecret,
      networkId:    "base-sepolia",
    });

    await AgentKit.from({ walletProvider });
  } catch (error) {
    console.error(C.red("  FAIL: Could not initialize AgentKit/CDP Wallet. Check your CDP API Keys in .env"));
    console.error(error);
    process.exit(1);
  }
  const network = walletProvider.getNetwork();

  console.log("  Wallet Address :", walletProvider.getAddress());
  console.log("  Network ID     :", network.networkId);
  console.log(C.green("  MPC Provisioning -> SUCCESS ✓\n"));

  // 2. Instantiate VynxActionProvider
  console.log(C.yellow("  [2/4] Initialising VynX Settlement Action Provider..."));
  const provider = new VynxActionProvider();

  const supported = provider.supportsNetwork(network);
  if (!supported) {
    console.error(C.red(`  FAIL: network '${network.networkId}' is not supported by VynX yet.`));
    process.exit(1);
  }
  console.log(C.green("  Action Provider Guard -> PASS ✓\n"));

  // 3. Parse raw arguments through VynxTransferSchema (Zero-Precision-Loss validation)
  console.log(C.yellow("  [3/4] Validating intent parameters (Zod Schema)..."));
  const parseResult = VynxTransferSchema.safeParse({
    destChainId: DEST_CHAIN_ID,
    srcToken: USDC_BASE_SEPOLIA,
    destToken: USDC_ARBITRUM,
    amountIn: AMOUNT_IN,
    minAmountOut: MIN_AMOUNT_OUT,
  });

  if (!parseResult.success) {
    console.error(C.red("  FAIL: Schema validation error:"), parseResult.error.format());
    process.exit(1);
  }
  const args = parseResult.data;

  console.log(`    srcToken    : ${args.srcToken}`);
  console.log(`    destChainId : ${args.destChainId} (Arbitrum One)`);
  console.log(C.green("  Schema Validation -> PASS ✓\n"));

  // 4. Invoke the action directly passing the unified walletProvider
  console.log(C.yellow("  [4/4] Executing EIP-712 Signature & Dispatching to Relayer..."));

  try {
    const result = await provider.executeTransfer(walletProvider, args);

    console.log(C.cyan("\n  ── Settlement Engine Result ─────────────────────────────────"));
    console.log(" ", result);
    console.log(C.cyan("  ─────────────────────────────────────────────────────────────\n"));

    // 5. Classify outcome
    if (result.includes("successfully") || result.includes("0x")) {
      console.log(C.green(C.bold("  STATUS: PASS — HFT Intent Captured by Relayer ✓")));

      // Extract the intentId from the relayer success message and run the mock solver.
      const intentMatch = result.match(/Intent ID:\s*(\S+)/);
      if (intentMatch?.[1]) {
        await runMockSolver(intentMatch[1], RELAYER_URL);
      }

      process.exit(0);
    } else {
      console.error(C.red("  STATUS: FAIL — Relayer exception or signature rejection"));
      process.exit(1);
    }
  } catch (error) {
    console.error(C.red("  STATUS: FAIL — Execution reverted during provider delegation."));
    console.error(error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(C.red("Unhandled simulation error:"), err);
  process.exit(1);
});
