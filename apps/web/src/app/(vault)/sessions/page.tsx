import {Placeholder} from "@/components/Placeholder";

export default function SessionsPage() {
  return (
    <Placeholder title="Sessions" phase="Phase 3">
      <p>Grant and withdraw the agent&apos;s authority.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Register a session key address and activate it with a policy.</li>
        <li>Live state: remaining daily allowance, time to expiry, allowlist.</li>
        <li>
          <strong className="text-deny">Revoke</strong> — always visible, one click, no
          confirmation buried in a menu. This is the operator&apos;s panic button, and
          revocation is permanent by design.
        </li>
      </ul>
    </Placeholder>
  );
}
