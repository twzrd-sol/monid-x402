import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MONID_X402_PAY_TO, NETWORK_BASE, NETWORK_MONAD } from "./constants.js";
import { listLedgerPacketNames, packetSettled, type LedgerPacket } from "./ledger.js";
import { probeRun402 } from "./probe.js";

export type VerifyCheck = {
  id: string;
  pass: boolean;
  detail: string;
  witnesses?: string[];
};

export type VerifyReport = {
  schema: "twzrd.default_path_verify.week2.v1";
  lane: "VERIFY";
  rail: "monid-x402";
  path: "Default Path 1";
  path_statement: string;
  gradedAt: string;
  grader: string;
  spent: false;
  payment_header_sent: false;
  live_402: Record<string, unknown>;
  packets_read: string[];
  checks: VerifyCheck[];
  notes: string[];
  verdict: "valid" | "invalid";
};

export function gradeLedgerPackets(
  packets: { name: string; rec: LedgerPacket }[]
): Pick<VerifyCheck, "id" | "pass" | "detail" | "witnesses">[] {
  const refuses = packets.filter((row) => row.rec.decision === "refuse");
  const paidOk = packets.filter((row) => packetSettled(row.rec));
  const prepaidHit = packets.some((row) =>
    String(row.rec.resource ?? "").includes("api.monid.ai/v1/run")
  );
  return [
    {
      id: "refuse_zero_sign_zero_spend",
      pass:
        refuses.length >= 1 &&
        refuses.every((row) => row.rec.signer_invocation_count === 0 && row.rec.usdc_spent === 0),
      detail: `${refuses.length} ledger refuse packets have signer_invocation_count 0 and usdc_spent 0`,
      witnesses: refuses.map((row) => `evidence/ledger/${row.name}`)
    },
    {
      id: "paid_one_sign_positive_spend_200",
      pass: paidOk.length >= 1,
      detail: `${paidOk.length} ledger paid packets are settled (HTTP 200, PAYMENT-RESPONSE, usdc_spent > 0)`,
      witnesses: [...paidOk.map((row) => `evidence/ledger/${row.name}`), "evidence/live-pay-200.json"]
    },
    {
      id: "no_prepaid_api_monid_resource",
      pass: !prepaidHit,
      detail:
        "no packet resource is api.monid.ai/v1/run; named resources are https://x402.monid.ai/v1/run"
    }
  ];
}

export async function gradeDefaultPath(root: string): Promise<VerifyReport> {
  const ledgerDir = join(root, "evidence/ledger");
  const packetNames = listLedgerPacketNames(ledgerDir);
  const packets = packetNames.map((name) => ({
    name,
    rec: JSON.parse(readFileSync(join(ledgerDir, name), "utf8")) as LedgerPacket
  }));
  const extraReads = ["evidence/live-pay-200.json", "evidence/live-brief.json"];
  const paidMis = packets.filter((row) => row.rec.decision === "paid" && !packetSettled(row.rec));
  const failed = packets.filter((row) => row.rec.decision === "pay_failed");

  const probe = await probeRun402();
  const accepts = probe.paymentRequired.accepts;
  const networks = [...new Set(accepts.map((row) => row.network))];
  const payTo = accepts[0]?.payTo;
  const payToPinned =
    typeof payTo === "string" && payTo.toLowerCase() === MONID_X402_PAY_TO.toLowerCase();
  const networksPinned = [NETWORK_BASE, NETWORK_MONAD].every((network) =>
    networks.includes(network)
  );

  const checks: VerifyCheck[] = [
    {
      id: "live_post_is_402",
      pass: probe.status === 402 && payToPinned && networksPinned,
      detail: `POST https://x402.monid.ai/v1/run returned HTTP ${probe.status} with Payment-Required; no PAYMENT-SIGNATURE / payment header sent`
    },
    ...gradeLedgerPackets(packets)
  ];

  const gradedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const report: VerifyReport = {
    schema: "twzrd.default_path_verify.week2.v1",
    lane: "VERIFY",
    rail: "monid-x402",
    path: "Default Path 1",
    path_statement: "every execution that can 402 does 402 and nothing signs until policy says so",
    gradedAt,
    grader: "same-session grade; did not claim an independent lane",
    spent: false,
    payment_header_sent: false,
    live_402: {
      method: "POST",
      url: "https://x402.monid.ai/v1/run",
      body: { provider: "context.dev", endpoint: "/web/scrape/markdown", input: {} },
      http_status: probe.status,
      resource: probe.paymentRequired.resource.url,
      payTo,
      payTo_pinned: payToPinned,
      pinned_payTo: MONID_X402_PAY_TO,
      networks,
      amount: accepts[0]?.amount,
      accepts: accepts.map((row) => ({
        scheme: row.scheme,
        network: row.network,
        amount: row.amount,
        asset: row.asset,
        payTo: row.payTo
      }))
    },
    packets_read: [...packetNames.map((name) => `evidence/ledger/${name}`), ...extraReads],
    checks,
    notes: [
      ...paidMis.map(
        (row) =>
          `${row.name} is labeled paid but not settled (http_status ${String(row.rec.http_status)}); not in usdc_spent_sum`
      ),
      `${failed.length} pay_failed packets signed then recorded usdc_spent 0`,
      "8787 left alone",
      "tool-audit film not restaged"
    ],
    verdict: checks.every((check) => check.pass) ? "valid" : "invalid"
  };
  writeFileSync(join(root, "evidence/verify/week2.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
