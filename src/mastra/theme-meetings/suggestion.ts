import { generateText, Output } from 'ai';
import { elmChatModel } from '../llm';
import { englishResponsePolicy, themeMeetingSuggestionPrompt } from '../prompts';
import { meetingSuggestionContext, themeProgressPlaceholders, themeStageGuidance, themeSuggestionSchema, ThemeSuggestionLengthError, validateThemeSuggestion } from './guidance';

export async function generateMeetingSuggestion(context: ReturnType<typeof meetingSuggestionContext>) {
  const prompt = `Today: ${new Date().toISOString().slice(0, 10)}.\nStage guidance: ${themeStageGuidance[context.stage]}\nSnapshot headings:\n${themeProgressPlaceholders[context.stage]}\nPROJECT_DATA_JSON:\n${JSON.stringify(context)}`;
  let shorten = '';
  // One automatic retry with an explicit shorter limit when the draft is too long; never truncate.
  for (let attempt = 0; ; attempt++) {
    const result = await generateText({
      model: elmChatModel, output: Output.object({ schema: themeSuggestionSchema }),
      maxOutputTokens: 2500, maxRetries: 0, abortSignal: AbortSignal.timeout(90000),
      system: `${themeMeetingSuggestionPrompt.system}\n${englishResponsePolicy}`,
      prompt: prompt + shorten,
    });
    if (result.finishReason === 'length') throw new Error('The suggestion was truncated. Please try again.');
    try {
      return { suggestion: validateThemeSuggestion(result.output, context), model: elmChatModel.modelId };
    } catch (error) {
      if (!(error instanceof ThemeSuggestionLengthError)) throw error;
      if (attempt > 0) throw new Error('The suggestion was still longer than 75 words after a shorter retry. Try again or write the update yourself.');
      shorten = `\nRETRY: your previous progress had ${error.words} words, over the 75-word limit. Rewrite progress in at most 50 words, counting each "-" marker as a word. Keep evidence quotes exact.`;
    }
  }
}
