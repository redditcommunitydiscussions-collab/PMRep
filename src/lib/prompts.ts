import { InterviewMode } from '../types';
import { generateDynamicPrompt } from './gemini';
import { db, auth } from '../firebase';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';

export const QUESTION_BANK: Record<InterviewMode, string[]> = {
  'Product Sense': [
    'Improve engagement on Instagram Reels.',
    'Design a feature for small businesses on WhatsApp.',
    'Create a new way for creators to monetize on Facebook Groups.',
    'Improve retention for WhatsApp Status.',
    'Design a feature to help users find local events on Facebook Marketplace.',
    'Evaluate and evolve the Messenger app for professional networking.',
    'Build a feature to reduce misinformation in WhatsApp Groups.',
    'Design a product for elderly users to stay connected with family on Facebook.',
    'Improve the discovery of new communities on Facebook Groups.',
    'Create a feature to encourage more original content creation on Instagram Stories.'
  ],
  'Analytics': [
    'Define success metrics for a new "Save for later" feature on Instagram.',
    'Engagement on Facebook Groups dropped by 15% yesterday. How would you debug this?',
    'Prioritize metrics for WhatsApp Calls.',
    'Evaluate the trade-offs of increasing the ad load on Instagram Reels.',
    'Diagnose a 10% drop in completion rate for Facebook Marketplace listings.',
    'Choose between launching a new filter on Instagram Stories vs. improving the camera load time.',
    'How would you measure the success of a new "Mute" feature on Messenger?',
    'WhatsApp Status views are up, but replies are down. Why might this be happening?',
    'Define the North Star metric for Facebook Events.',
    'A new feature increases time spent but decreases daily active users. What do you do?'
  ],
  'Leadership / Behavioral': [
    'Tell me about a time you had a conflict with an engineering stakeholder.',
    'Describe a situation where you took ownership of a failing project.',
    'Give an example of leading a team without formal authority.',
    'Tell me about a time you had to make a decision with highly ambiguous data.',
    'Describe a product failure you experienced and what you learned from it.',
    'Tell me about a time you grew a team or improved a core process.',
    'Give an example of a time you had to push back on leadership.',
    'Describe a situation where you had to pivot your product strategy quickly.',
    'Tell me about a time you had to influence a cross-functional team to adopt your vision.',
    'Give an example of how you handled a critical bug or outage in production.'
  ]
};

export function getRandomPrompt(mode?: InterviewMode | 'Mixed'): { prompt: string; mode: InterviewMode } {
  let selectedMode: InterviewMode;
  
  if (!mode || mode === 'Mixed') {
    const modes: InterviewMode[] = ['Product Sense', 'Analytics', 'Leadership / Behavioral'];
    selectedMode = modes[Math.floor(Math.random() * modes.length)];
  } else {
    selectedMode = mode;
  }

  const prompts = QUESTION_BANK[selectedMode];
  const prompt = prompts[Math.floor(Math.random() * prompts.length)];

  return { prompt, mode: selectedMode };
}

const CACHE_KEY = 'pm_coach_prompt_cache';

interface PromptCache {
  'Product Sense': string[];
  'Analytics': string[];
  'Leadership / Behavioral': string[];
}

function loadCache(): PromptCache {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {}
  return { 'Product Sense': [], 'Analytics': [], 'Leadership / Behavioral': [] };
}

function saveCache(cache: PromptCache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export function getInstantPrompt(mode: InterviewMode): { prompt: string, mode: InterviewMode } {
  const cache = loadCache();
  if (cache[mode] && cache[mode].length > 0) {
    const prompt = cache[mode].shift()!;
    saveCache(cache);
    return { prompt, mode };
  }
  // Fallback to hardcoded if cache is empty
  return getRandomPrompt(mode);
}

export async function replenishPromptCache(mode: InterviewMode, recentMistakes: string[] = []) {
  const cache = loadCache();
  // Keep a max of 3 prompts per mode to avoid excessive API calls
  if (cache[mode].length >= 3) return;

  try {
    const newPrompt = await generateDynamicPrompt(mode, recentMistakes);
    const updatedCache = loadCache(); // reload in case it changed
    updatedCache[mode].push(newPrompt);
    saveCache(updatedCache);

    // Save to Firestore if user is authenticated
    if (auth.currentUser) {
      const questionRef = doc(collection(db, 'questions'));
      await setDoc(questionRef, {
        id: questionRef.id,
        prompt: newPrompt,
        mode: mode,
        difficulty: 'medium', // Defaulting to medium for now
        generatedByUid: auth.currentUser.uid,
        createdAt: serverTimestamp()
      });
    }
  } catch (e) {
    console.error("Failed to replenish prompt cache", e);
  }
}
