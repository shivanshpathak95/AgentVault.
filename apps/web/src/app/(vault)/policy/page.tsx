import {Placeholder} from "@/components/Placeholder";

export default function PolicyPage() {
  return (
    <Placeholder title="Policy" phase="Phase 3">
      <p>Author the rules the contract will enforce. This is the operator&apos;s real work.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>maxPerTx</strong> — ceiling on any single payment.
        </li>
        <li>
          <strong>dailyLimit</strong> — ceiling on cumulative spend per UTC day.
        </li>
        <li>
          <strong>expiresAt</strong> — when the session dies on its own.
        </li>
        <li>
          <strong>Recipient allowlist</strong> — the only addresses the agent may pay.
        </li>
      </ul>
      <p>
        Every field is entered in decimal USDC and converted in one place
        (<code>@agentvault/shared/usdc</code>), never ad hoc. Show the operator the exact
        values they are about to sign, in decimals, before the wallet prompt.
      </p>
    </Placeholder>
  );
}
