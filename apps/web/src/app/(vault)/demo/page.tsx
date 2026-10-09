import {Placeholder} from "@/components/Placeholder";

export default function DemoPage() {
  return (
    <Placeholder title="Agent demo" phase="Phase 4–5">
      <p>
        The live console: prompt the agent, watch each policy decision land on chain.
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Stream the agent transcript: model reasoning → tool call → contract verdict.</li>
        <li>
          One-click scripted scenarios for every blocked flow — unauthorized recipient,
          over maxPerTx, over the daily limit, expired session, revoked session.
        </li>
        <li>
          The prompt-injection scenario: the paid service returns a poisoned instruction, the
          model complies, and the contract refuses anyway.
        </li>
      </ul>
      <p>
        This page is the pitch, not polish. If the schedule slips, cut styling elsewhere
        before cutting these scenarios.
      </p>
    </Placeholder>
  );
}
