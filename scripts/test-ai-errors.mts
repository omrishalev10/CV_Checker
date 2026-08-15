import { humanizeAiError, isRetryableAiError, parseProviderError } from "../server/src/services/aiErrors.ts";

const busy = '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}';

const parsed = parseProviderError(new Error(busy));
if (parsed.code !== 503 || parsed.status !== "UNAVAILABLE") {
  throw new Error(`parse failed: ${JSON.stringify(parsed)}`);
}
if (!isRetryableAiError(new Error(busy))) throw new Error("503 should be retryable");

const human = humanizeAiError(new Error(busy));
if (!/busy/i.test(human.message) || human.message.includes("{")) {
  throw new Error(`humanize failed: ${human.message}`);
}

console.log("ai error cases passed");
