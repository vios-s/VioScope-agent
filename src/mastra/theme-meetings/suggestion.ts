import { generateText, Output } from 'ai';
import { elmChatModel } from '../llm';
import { englishResponsePolicy, themeMeetingSuggestionPrompt } from '../prompts';
import { meetingSuggestionContext, themeStagePrompt, themeSuggestionSchema, ThemeSuggestionLengthError, ThemeSuggestionRetryError, validateThemeSuggestion } from './guidance';

export async function generateMeetingSuggestion(context: ReturnType<typeof meetingSuggestionContext>) {
  const prompt = `Today: ${new Date().toISOString().slice(0, 10)}.\n${themeStagePrompt(context.stage)}\nCitable evidence source keys (use exactly these in evidence[].source): ${Object.keys(context.sources).join(', ') || 'none'}\nPROJECT_DATA_JSON:\n${JSON.stringify(context)}`;
  let retry = '';
  // One automatic retry with an explicit instruction (shorter draft, valid evidence keys or English); never truncate.
  for (let attempt = 0; ; attempt++) {
    const result = await generateText({
      model: elmChatModel, output: Output.object({ schema: themeSuggestionSchema }),
      maxOutputTokens: 2500, maxRetries: 0, abortSignal: AbortSignal.timeout(90000),
      system: `${themeMeetingSuggestionPrompt.system}\n${englishResponsePolicy}`,
      prompt: prompt + retry,
    });
    if (result.finishReason === 'length') throw new Error('The suggestion was truncated. Please try again.');
    try {
      return { suggestion: validateThemeSuggestion(result.output, context), model: elmChatModel.modelId };
    } catch (error) {
      if (!(error instanceof ThemeSuggestionRetryError)) throw error;
      if (attempt > 0) {
        throw error instanceof ThemeSuggestionLengthError
          ? new Error('The suggestion was still longer than 75 words after a shorter retry. Try again or write the update yourself.')
          : new Error(error.message.replace('Try again.', 'Try again or write the update yourself.'));
      }
      retry = `\n${error.retry}`;
    }
  }
}
