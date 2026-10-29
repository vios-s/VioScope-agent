import { generateText, Output } from 'ai';
import { elmChatModel } from '../llm';
import { englishResponsePolicy, themeMeetingSuggestionPrompt } from '../prompts';
import { meetingSuggestionContext, themeProgressPlaceholders, themeStageGuidance, themeSuggestionSchema, validateThemeSuggestion } from './guidance';

export async function generateMeetingSuggestion(context: ReturnType<typeof meetingSuggestionContext>) {
  const result = await generateText({
    model: elmChatModel, output: Output.object({ schema: themeSuggestionSchema }),
    maxOutputTokens: 2500, maxRetries: 0, abortSignal: AbortSignal.timeout(90000),
    system: `${themeMeetingSuggestionPrompt.system}\n${englishResponsePolicy}`,
    prompt: `Today: ${new Date().toISOString().slice(0, 10)}.\nStage guidance: ${themeStageGuidance[context.stage]}\nSnapshot headings:\n${themeProgressPlaceholders[context.stage]}\nPROJECT_DATA_JSON:\n${JSON.stringify(context)}`,
  });
  if (result.finishReason === 'length') throw new Error('The suggestion was truncated. Please try again.');
  return { suggestion: validateThemeSuggestion(result.output, context), model: elmChatModel.modelId };
}
