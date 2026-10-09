import {Placeholder} from "@/components/Placeholder";

export default function VaultPage() {
  return (
    <Placeholder title="Vault" phase="Phase 3">
      <p>Create a vault through the factory, fund it, and show its USDC balance.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Connect wallet; hard-guard the chain against the configured Arc chain id.</li>
        <li>
          <code>factory.createVault(owner, salt)</code>, with the address previewed via{" "}
          <code>predictVaultAddress</code> before deploying.
        </li>
        <li>
          Fund: <code>usdc.approve(vault, amount)</code> then <code>vault.deposit(amount)</code>.
        </li>
        <li>Show the vault&apos;s 6dp ERC-20 balance, and the session key&apos;s native gas balance separately.</li>
        <li>Withdraw — always available to the operator, never gated.</li>
      </ul>
    </Placeholder>
  );
}
