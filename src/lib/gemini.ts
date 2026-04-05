import { GoogleGenAI, Type } from '@google/genai';
import { DrillRep, InterviewMode } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const getSystemInstruction = (userName: string) => `You are an AI interview training coach specialized for ${userName}.
Your job is to help them prepare for Meta and similar PM interviews by training their real weakness:
- they have strong product sense and strong real-world execution
- but under interview pressure they expand too early, go abstract, mix modes, or get stuck before committing
- they need fast, structured, repeatable practice that builds automatic response quality

Your coaching style must be:
- direct, honest, specific, practical
- encouraging but never falsely reassuring
- focused on repetition, clarity, and pattern correction
- no fluff, no generic PM framework dumping unless asked

IMPORTANT USER PROFILE & PERSONALIZATION:
- senior product leader with deep execution experience
- strong in systems thinking, product intuition, ambiguity handling, real-world delivery
- struggles with: choosing correct interview mode quickly, solution sizing, starting narrow instead of expanding early, showing structure under pressure, moving forward before feeling fully ready
- learns best through rapid drills, repetition, pattern-based correction
- prefers simple language and shorter sentences
- do not use em dashes
- avoid overexplaining

You will be provided with the user's HISTORICAL CONTEXT (recent mistakes, recent strengths, and average scores). 
CRITICAL: You MUST use this historical context to deeply personalize your critique. 
- If they made a mistake they frequently make, point it out: "You fell back into your habit of being too broad."
- If they avoided a frequent mistake, praise them: "Great job staying concrete this time, I know you've been working on that."
- Make them feel like you remember their past performance and are actively tracking their growth.

CORE TRAINING OBJECTIVE:
Build automatic first-response quality for PM interviews.

PRIMARY FRAMEWORKS TO TEACH:
A. PRODUCT SENSE MODE
1. Pick one user
2. Define one problem
3. Propose one simple feature
4. Add only two concrete details
Internal rule: start small, stay focused, expand later only if needed.

B. ANALYTICAL THINKING MODE
1. Define the goal or metric
2. Break it into 2 to 3 parts
3. Identify where the issue is
4. Give one hypothesis or next step
Internal rule: define, break, debug.

C. MODE SWITCHING RULE
- Product Sense: improve, design, create, build, add a feature
- Analytics: measure, metric, why dropped, success, evaluate, track
- Leadership / Behavioral: past experience, conflict, results, influence, failure, leadership

D. UNSTUCK PROTOCOL
If user gets stuck/abstract: "Let me simplify this to a first version." Force reset: one user, one problem, one feature.

E. +2 DETAILS RULE
If user gives generic solution (dashboard, AI system, platform), force them to make it concrete with only 2 details (e.g., "2-minute guided journal").

GUARDRAILS:
1. Do not praise weak answers as strong.
2. Do not say user is interview-ready unless consistently strong.
3. Do not overcorrect into long answers.
4. Max 4 sentences for Product Sense, 5 for Analytics.
5. Do not let user answer in vague terms (platform, ecosystem) unless followed by a concrete feature.
6. Point out mixed modes immediately.
7. If too big: "What is the smallest useful version?"
8. If frozen: "Start with a simple approach."
9. Focus on skill-building, not just answer-giving.

TONE:
- clear, direct, non-fluffy, practical, no fake positivity, always oriented toward skill repetition.

OUTPUT FORMAT:
Provide a JSON response with:
- expectedMode: The correct mode for the prompt.
- critique: Fast and precise critique of the user's answer. MUST reference their historical context if relevant.
- correctedAnswer: A tighter, corrected version of the answer (max 4-5 sentences).
- mistakeTags: Array of weakness tags (from the allowed list).
- strengthTags: Array of strength tags (from the allowed list).
- microLesson: One short sentence lesson.
- scores: Object with scores 1-5 for relevant dimensions.`;

export async function evaluateAnswer(
  prompt: string,
  userAnswer: string,
  userSelectedMode: InterviewMode,
  timeTakenSeconds: number,
  userContext?: {
    recentMistakes: string[];
    recentStrengths: string[];
    userName?: string;
  }
): Promise<Partial<DrillRep>> {
  
  const userName = userContext?.userName || 'User';
  const contextString = userContext 
    ? `\nHISTORICAL CONTEXT FOR THIS USER:\n- Frequently struggles with: ${userContext.recentMistakes.join(', ') || 'None yet'}\n- Frequently excels at: ${userContext.recentStrengths.join(', ') || 'None yet'}\nUse this context to personalize your critique.`
    : '';

  const generatePromise = ai.models.generateContent({
    model: 'gemini-3-flash-preview', // Using flash for faster evaluations in Car Mode
    contents: `Prompt: "${prompt}"
User Selected Mode: ${userSelectedMode}
Time Taken: ${timeTakenSeconds} seconds
User Answer: "${userAnswer}"${contextString}`,
    config: {
      systemInstruction: getSystemInstruction(userName),
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          expectedMode: {
            type: Type.STRING,
            description: "The correct mode for this prompt: 'Product Sense', 'Analytics', or 'Leadership / Behavioral'",
          },
          critique: {
            type: Type.STRING,
            description: "Fast and precise critique of the user's answer. MUST reference their historical context if relevant.",
          },
          correctedAnswer: {
            type: Type.STRING,
            description: "A tighter, corrected version of the answer (max 4-5 sentences).",
          },
          mistakeTags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Array of weakness tags from: wrong_mode, too_broad, too_big_solution, vague_feature, too_many_ideas, weak_metric, poor_breakdown, no_goal_defined, froze_before_answering, abstract_language, no_concrete_details, mixed_product_and_analytics, overexplained, underexplained",
          },
          strengthTags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Array of strength tags from: strong_user_selection, strong_problem_identification, good_solution_sizing, strong_metric_definition, clean_breakdown, good_tradeoff_reasoning, strong_recovery_after_stuck, concrete_feature_design, clear_mode_selection",
          },
          microLesson: {
            type: Type.STRING,
            description: "One short sentence lesson.",
          },
          retryPrompt: {
            type: Type.STRING,
            description: "If the answer can be improved, provide a prompt for a retry: highlight the biggest gap only, give 1-2 precise fixes, and ask for a shorter, clearer second attempt. If the answer is perfect, return an empty string.",
          },
          scores: {
            type: Type.OBJECT,
            properties: {
              modeSelection: { type: Type.NUMBER },
              structure: { type: Type.NUMBER },
              clarity: { type: Type.NUMBER },
              focus: { type: Type.NUMBER },
              concreteness: { type: Type.NUMBER },
              solutionSizingOrMetricLogic: { type: Type.NUMBER },
              recoveryUnderPressure: { type: Type.NUMBER },
            },
            required: ["modeSelection", "structure", "clarity", "focus", "concreteness", "solutionSizingOrMetricLogic", "recoveryUnderPressure"],
          },
        },
        required: ["expectedMode", "critique", "correctedAnswer", "mistakeTags", "strengthTags", "microLesson", "retryPrompt", "scores"],
      },
    },
  });

  const timeoutPromise = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error('Request timed out')), 45000)
  );

  const response = await Promise.race([generatePromise, timeoutPromise]);

  const text = response.text;
  if (!text) throw new Error('No response from AI');
  
  const result = JSON.parse(text);
  return result;
}

export async function evaluateRetry(
  prompt: string,
  firstAnswer: string,
  retryAnswer: string,
  userName: string = 'User'
): Promise<{ 
  comparison: string; 
  remainingGap: string; 
  correctedAnswer: string;
  retryMistakeTags: string[];
  retryStrengthTags: string[];
  retryScores: any;
}> {
  const generatePromise = ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Prompt: "${prompt}"
First Answer: "${firstAnswer}"
Retry Answer: "${retryAnswer}"`,
    config: {
      systemInstruction: `You are an AI interview training coach for ${userName}.
The user has just submitted a retry for an interview question.
Your task is to:
1. Compare the retry with the first answer.
2. Acknowledge improvement if any.
3. Note one remaining gap if needed.
4. Provide a tighter, corrected version of the answer (max 4-5 sentences).
5. Provide new scores and tags for the retry answer.

Tone: direct, honest, specific, practical, encouraging but never falsely reassuring.`,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          comparison: {
            type: Type.STRING,
            description: "Compare the retry with the first answer, acknowledging improvement if any."
          },
          remainingGap: {
            type: Type.STRING,
            description: "Note one remaining gap if needed. If perfect, return an empty string."
          },
          correctedAnswer: {
            type: Type.STRING,
            description: "A tighter, corrected version of the answer (max 4-5 sentences)."
          },
          retryMistakeTags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Array of weakness tags from: wrong_mode, too_broad, too_big_solution, vague_feature, too_many_ideas, weak_metric, poor_breakdown, no_goal_defined, froze_before_answering, abstract_language, no_concrete_details, mixed_product_and_analytics, overexplained, underexplained",
          },
          retryStrengthTags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Array of strength tags from: strong_user_selection, strong_problem_identification, good_solution_sizing, strong_metric_definition, clean_breakdown, good_tradeoff_reasoning, strong_recovery_after_stuck, concrete_feature_design, clear_mode_selection",
          },
          retryScores: {
            type: Type.OBJECT,
            properties: {
              modeSelection: { type: Type.NUMBER },
              structure: { type: Type.NUMBER },
              clarity: { type: Type.NUMBER },
              focus: { type: Type.NUMBER },
              concreteness: { type: Type.NUMBER },
              solutionSizingOrMetricLogic: { type: Type.NUMBER },
              recoveryUnderPressure: { type: Type.NUMBER },
            },
            required: ["modeSelection", "structure", "clarity", "focus", "concreteness", "solutionSizingOrMetricLogic", "recoveryUnderPressure"],
          },
        },
        required: ["comparison", "remainingGap", "correctedAnswer", "retryMistakeTags", "retryStrengthTags", "retryScores"]
      }
    }
  });

  const timeoutPromise = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error('Request timed out')), 45000)
  );

  const response = await Promise.race([generatePromise, timeoutPromise]);
  
  const text = response.text;
  if (!text) throw new Error('No response from AI');
  
  const result = JSON.parse(text);
  return result;
}

const PROMPT_GENERATOR_INSTRUCTION = `You are an expert Meta PM interviewer.
Generate ONE completely new, realistic Meta PM interview question for the requested mode.

QUALITY GUARDRAILS & EVALUATION:
1. Product Sense: Must target a specific Meta product (Instagram, WhatsApp, Facebook, Threads, Quest, Ray-Ban) or a strategic user segment. Must be 1 short sentence. Example: "Improve engagement for Instagram Creators." or "Design a product for small businesses on WhatsApp."
2. Analytics: Must present a specific metric drop, success measurement, or trade-off. Example: "Facebook Groups daily active users dropped by 8%. How do you debug?" or "How do you measure success for WhatsApp Status?"
3. Leadership: Must use "Tell me about a time..." focusing on conflict, ambiguity, failure, or influence.
4. The question must be ambiguous enough to require structuring, but not a vague word salad.
5. Do NOT output multi-part questions. Keep it punchy.

If the user has recent mistakes, tailor the difficulty to force them to practice that weakness (e.g., if they struggle with 'too_broad', give a very specific constraint).

Output JSON with a single 'prompt' string field.`;

export async function generateDynamicPrompt(mode: InterviewMode, recentMistakes: string[] = []): Promise<string> {
  const generatePromise = ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Mode: ${mode}\nRecent User Mistakes: ${recentMistakes.join(', ')}`,
    config: {
      systemInstruction: PROMPT_GENERATOR_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          prompt: { type: Type.STRING, description: "The generated interview question." }
        },
        required: ["prompt"]
      }
    }
  });

  const timeoutPromise = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error('Request timed out')), 25000)
  );

  const response = await Promise.race([generatePromise, timeoutPromise]);
  
  const text = response.text;
  if (!text) throw new Error('No response from AI');
  
  const result = JSON.parse(text);
  return result.prompt;
}
