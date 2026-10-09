import Anthropic from "@anthropic-ai/sdk";
import {AGENT_SYSTEM_PROMPT, agentTools, executeTool, type ToolContext} from "./tools.ts";

/**
 * The agent loop: a direct Messages API tool-calling implementation.
 *
 * No framework. The whole loop is thirty lines — call the model, run whatever
 * tools it asked for, feed the results back, repeat until it stops asking. A
 * framework would add indirection between the model's request to spend money
 * and the code that decides whether to, which is the one place in this system
 * where indirection is least welcome.
 *
 * Two API details that matter on Claude Opus 5.5:
 *   - Thinking is adaptive and cannot be disabled; effort defaults to `medium`,
 *     so it is set explicitly rather than left to drift with the default.
 *   - Forced `tool_choice` ("any"/"tool") is rejected with a 400 on this model.
 *     The loop uses `auto` and steers from the system prompt instead.
 */

export interface TranscriptEntry {
  step: number;
  kind: "assistant_text" | "tool_call" | "tool_result";
  name?: string;
  text?: string;
  input?: unknown;
  output?: unknown;
}

export interface AgentRunResult {
  finalText: string;
  transcript: TranscriptEntry[];
  steps: number;
  stopReason: string | null;
  usage: {inputTokens: number; outputTokens: number};
}

/** Guards against a model that loops on a refused payment despite instruction. */
const MAX_STEPS = 12;

export async function runAgent(
  ctx: ToolContext,
  prompt: string,
  options: {maxSteps?: number} = {},
): Promise<AgentRunResult> {
  const client = new Anthropic({apiKey: ctx.config.anthropicApiKey});
  const maxSteps = options.maxSteps ?? MAX_STEPS;

  const messages: Anthropic.MessageParam[] = [{role: "user", content: prompt}];
  const transcript: TranscriptEntry[] = [];

  let steps = 0;
  let stopReason: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  while (steps < maxSteps) {
    steps++;

    const response = await client.messages.create({
      model: ctx.config.anthropicModel,
      max_tokens: 8192,
      system: AGENT_SYSTEM_PROMPT,
      tools: agentTools,
      messages,
      thinking: {type: "adaptive"},
      output_config: {effort: "medium"},
    });

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    stopReason = response.stop_reason;

    // A safety classifier declined the request. Surface it rather than looping.
    if (response.stop_reason === "refusal") {
      return {
        finalText:
          "The model declined to continue with this request. Nothing was spent. " +
          (response.stop_details?.explanation ?? ""),
        transcript,
        steps,
        stopReason,
        usage: {inputTokens, outputTokens},
      };
    }

    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        transcript.push({step: steps, kind: "assistant_text", text: block.text});
      }
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      return {finalText, transcript, steps, stopReason, usage: {inputTokens, outputTokens}};
    }

    // Echo the assistant turn back verbatim, thinking blocks included — the API
    // needs them intact to continue the same reasoning thread.
    messages.push({role: "assistant", content: response.content});

    // Parallel tool calls must come back as tool_result blocks in ONE user
    // message; splitting them teaches the model to stop calling tools in
    // parallel.
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUses) {
      transcript.push({
        step: steps,
        kind: "tool_call",
        name: toolUse.name,
        input: toolUse.input,
      });

      const output = await executeTool(ctx, toolUse.name, toolUse.input);

      transcript.push({
        step: steps,
        kind: "tool_result",
        name: toolUse.name,
        output,
      });

      results.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(output),
      });
    }

    messages.push({role: "user", content: results});
  }

  return {
    finalText:
      `Stopped after ${maxSteps} steps without finishing. This usually means a payment was ` +
      `refused and the task cannot be completed under the current policy.`,
    transcript,
    steps,
    stopReason,
    usage: {inputTokens, outputTokens},
  };
}
