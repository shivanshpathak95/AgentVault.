import {Placeholder} from "@/components/Placeholder";

export default function ActivityPage() {
  return (
    <Placeholder title="Activity" phase="Phase 3">
      <p>The ledger. Approved and refused payments shown with equal weight.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Read <code>PaymentExecuted</code> logs from the vault — amount, recipient, intent
          hash, explorer link.
        </li>
        <li>
          Show rejections alongside them, with the decoded <code>RejectionReason</code> and the
          attempted recipient.
        </li>
      </ul>
      <p>
        Rejections are the product working, not errors to hide. A ledger that showed only
        successful payments would be describing a wallet.
      </p>
    </Placeholder>
  );
}
