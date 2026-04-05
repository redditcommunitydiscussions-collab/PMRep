import { useState, useEffect, useRef, useCallback } from 'react';
import { InterviewMode, DrillSession, DrillRep } from '../types';
import { getInstantPrompt, replenishPromptCache } from '../lib/prompts';
import { evaluateAnswer } from '../lib/gemini';
import { generateSpeech } from '../lib/tts';
import { useStore } from '../lib/store';
import { v4 as uuidv4 } from 'uuid';
import { Mic, MicOff, Car, Loader2, StopCircle } from 'lucide-react';
import { auth } from '../firebase';

type CarModeState = 'idle' | 'reading_prompt' | 'listening_answer' | 'evaluating' | 'reading_feedback' | 'listening_command' | 'asking_if_done';

interface CarModeScreenProps {
  onEndSession: () => void;
  recentMistakes: string[];
}

export function CarModeScreen({ onEndSession, recentMistakes }: CarModeScreenProps) {
  const { saveSession, updateSession, saveRep } = useStore();
  const [state, setState] = useState<CarModeState>('idle');
  const stateRef = useRef<CarModeState>('idle');

  const setCarState = useCallback((newState: CarModeState) => {
    stateRef.current = newState;
    setState(newState);
  }, []);
  const [currentPrompt, setCurrentPrompt] = useState<{prompt: string, mode: InterviewMode} | null>(null);
  const [transcript, setTranscript] = useState('');
  const [session, setSession] = useState<DrillSession>({
    id: uuidv4(),
    date: new Date().toISOString(),
    mode: 'Product Sense', // Defaulting to Product Sense for Car Mode as requested
    reps: []
  });

  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis>(window.speechSynthesis);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const silenceIntervalRef = useRef<number | null>(null);
  const silenceSecondsRef = useRef<number>(0);
  const [silenceCounter, setSilenceCounter] = useState(0);
  const startTimeRef = useRef<number>(0);

  const [voicesLoaded, setVoicesLoaded] = useState(false);

  // Initialize Speech Recognition and Voices
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
    }

    saveSession(session);
    
    const handleVoicesChanged = () => {
      setVoicesLoaded(true);
    };
    
    window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged);
    if (window.speechSynthesis.getVoices().length > 0) {
      setVoicesLoaded(true);
    }
    
    // Pre-fill cache for Car Mode
    replenishPromptCache('Product Sense', recentMistakes);
    
    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
      synthRef.current.cancel();
      if (currentAudioSourceRef.current) {
        try {
          currentAudioSourceRef.current.stop();
          currentAudioSourceRef.current.disconnect();
        } catch (e) {}
      }
      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch (e) {}
      }
      if (silenceIntervalRef.current) window.clearInterval(silenceIntervalRef.current);
      window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
    };
  }, []);

  const speakTimeoutRef = useRef<number | null>(null);

  const speak = async (text: string, onEnd?: () => void) => {
    // Stop listening while speaking
    stopListening();
    
    if (currentUtteranceRef.current) {
      currentUtteranceRef.current.onend = null;
    }
    synthRef.current.cancel();
    
    if (currentAudioSourceRef.current) {
      try {
        currentAudioSourceRef.current.stop();
        currentAudioSourceRef.current.disconnect();
      } catch (e) {}
      currentAudioSourceRef.current = null;
    }

    if (speakTimeoutRef.current) {
      window.clearTimeout(speakTimeoutRef.current);
    }
    
    try {
      // Try Gemini TTS first for a sweeter voice
      const audioBuffer = await generateSpeech(text, 'Kore'); // 'Kore' is a pleasant female voice
      
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      currentAudioSourceRef.current = source;
      
      source.onended = () => {
        currentAudioSourceRef.current = null;
        if (onEnd) onEnd();
      };
      
      source.start();
    } catch (e) {
      console.error("Gemini TTS failed, falling back to Web Speech API", e);
      // Fallback to Web Speech API
      const utterance = new SpeechSynthesisUtterance(text);
      currentUtteranceRef.current = utterance;
      
      // Select a sweeter, more natural human voice
      const availableVoices = window.speechSynthesis.getVoices();
      const preferredVoiceNames = [
        'Google US English', // Chrome's natural voice
        'Samantha', // Apple's natural female voice
        'Karen', // Apple
        'Tessa', // Apple
        'Victoria', // Apple
        'Microsoft Aria', // Windows natural female
        'Microsoft Zira' // Windows female
      ];

      let selectedVoice = null;
      for (const name of preferredVoiceNames) {
        selectedVoice = availableVoices.find(v => v.name.includes(name));
        if (selectedVoice) break;
      }

      if (!selectedVoice) {
        selectedVoice = availableVoices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female')) || 
                        availableVoices.find(v => v.lang.startsWith('en'));
      }

      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      // Adjust pitch and rate for a sweeter, less harsh tone
      utterance.pitch = 1.15; // Slightly higher pitch
      utterance.rate = 0.95;  // Slightly slower, more conversational pace
      
      if (onEnd) {
        utterance.onend = () => {
          if (currentUtteranceRef.current === utterance) {
            onEnd();
          }
        };
      }
      
      // Chrome bug workaround: sometimes speech synthesis gets stuck
      // A small timeout helps ensure the cancel() is fully processed
      speakTimeoutRef.current = window.setTimeout(() => {
        synthRef.current.speak(utterance);
        speakTimeoutRef.current = null;
      }, 50);
    }
  };

  const startListening = (onResult: (text: string, isFinal: boolean) => void) => {
    if (!recognitionRef.current) return;
    
    recognitionRef.current.onresult = (event: any) => {
      let currentTranscript = '';
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        currentTranscript += event.results[i][0].transcript;
        if (event.results[i].isFinal) isFinal = true;
      }
      onResult(currentTranscript, isFinal);
    };

    recognitionRef.current.onerror = (event: any) => {
      console.error('Speech recognition error', event.error);
      // Try to restart if it's a network error or no-speech
      if (event.error === 'no-speech' || event.error === 'network') {
        try { recognitionRef.current.start(); } catch (e) {}
      }
    };

    recognitionRef.current.onend = () => {
      // Auto-restart if we are supposed to be listening
      if (stateRef.current === 'listening_answer' || stateRef.current === 'listening_command') {
        try { recognitionRef.current.start(); } catch (e) {}
      }
    };

    try {
      recognitionRef.current.start();
    } catch (e) {
      // Already started
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
    }
  };

  const transcriptRef = useRef<string>('');

  const clearSilenceTimer = () => {
    if (silenceIntervalRef.current) {
      window.clearInterval(silenceIntervalRef.current);
      silenceIntervalRef.current = null;
    }
  };

  const startSilenceTimer = (promptObj: {prompt: string, mode: InterviewMode}) => {
    clearSilenceTimer();
    silenceSecondsRef.current = 0;
    setSilenceCounter(0);
    
    silenceIntervalRef.current = window.setInterval(() => {
      silenceSecondsRef.current += 1;
      
      if (silenceSecondsRef.current > 5) {
        setSilenceCounter(silenceSecondsRef.current - 5);
      } else {
        setSilenceCounter(0);
      }
      
      if (silenceSecondsRef.current >= 25) {
        clearSilenceTimer();
        stopListening();
        askIfDone(promptObj);
      }
    }, 1000);
  };

  const askIfDone = (promptObj: {prompt: string, mode: InterviewMode}) => {
    setCarState('asking_if_done');
    speak("Just checking in, are you done with your answer?", () => {
      setCarState('listening_command');
      startListening((text, isFinal) => {
        const cmd = text.toLowerCase();
        if (cmd.includes('end session') || cmd.includes('and session') || cmd.includes('stop session') || cmd.includes('finish session') || cmd.includes('end drive')) {
          handleEndSession();
        } else if (cmd.match(/\b(yes|yeah|yep|done)\b/)) {
          stopListening();
          processAnswer(transcriptRef.current, promptObj);
        } else if (cmd.match(/\b(no|not yet|wait)\b/)) {
          stopListening();
          speak("Okay, take your time.", () => {
            startListeningForAnswer(promptObj, true);
          });
        } else if (isFinal || text.length > 15) {
          // If they didn't say yes/no and just continued speaking, append it and resume
          stopListening();
          transcriptRef.current = transcriptRef.current + (transcriptRef.current ? ' ' : '') + text;
          setTranscript(transcriptRef.current);
          startListeningForAnswer(promptObj, true);
        }
      });
    });
  };

  const startListeningForAnswer = (promptObj: {prompt: string, mode: InterviewMode}, isResuming = false) => {
    setCarState('listening_answer');
    
    if (!isResuming) {
      startTimeRef.current = Date.now();
      transcriptRef.current = '';
      setTranscript('');
    }
    
    let fullAnswer = transcriptRef.current;
    
    startSilenceTimer(promptObj);
    
    startListening((text, isFinal) => {
      startSilenceTimer(promptObj); // Reset timer on speech
      
      const cmdText = text.toLowerCase();
      
      if (cmdText.includes('end session') || cmdText.includes('and session') || cmdText.includes('stop session') || cmdText.includes('finish session') || cmdText.includes('end drive')) {
        handleEndSession();
        return;
      }

      if (cmdText.includes('repeat the question') || cmdText.includes('repeat question') || cmdText.includes('say that again')) {
        clearSilenceTimer();
        stopListening();
        setCarState('reading_prompt');
        setTranscript('');
        transcriptRef.current = '';
        speak(`The question is: ${promptObj.prompt}. Take your time. Say "I am done" when you finish.`, () => {
          startListeningForAnswer(promptObj);
        });
        return;
      }

      if (cmdText.match(/\b(i am done|i'm done|submit answer|that's my answer)\b/)) {
        clearSilenceTimer();
        stopListening();
        // Remove the command from the transcript before submitting
        const cleanAnswer = transcriptRef.current
          .replace(/i am done/gi, '')
          .replace(/i'm done/gi, '')
          .replace(/submit answer/gi, '')
          .replace(/that's my answer/gi, '')
          .trim();
        processAnswer(cleanAnswer, promptObj);
        return;
      }

      const newTranscript = fullAnswer + (fullAnswer && text ? ' ' : '') + text;
      setTranscript(newTranscript);
      transcriptRef.current = newTranscript;
      
      if (isFinal) {
        fullAnswer += (fullAnswer && text ? ' ' : '') + text;
      }
    });
  };

  const handleEndSession = () => {
    clearSilenceTimer();
    stopListening();
    if (currentUtteranceRef.current) {
      currentUtteranceRef.current.onend = null;
    }
    synthRef.current.cancel();
    if (currentAudioSourceRef.current) {
      try {
        currentAudioSourceRef.current.stop();
        currentAudioSourceRef.current.disconnect();
      } catch (e) {}
      currentAudioSourceRef.current = null;
    }
    if (speakTimeoutRef.current) {
      window.clearTimeout(speakTimeoutRef.current);
    }
    onEndSession();
  };

  const handleNextQuestion = () => {
    setCarState('idle');
    setTranscript('');
    const prompt = getInstantPrompt('Product Sense');
    setCurrentPrompt(prompt);
    
    // Fire background replenishment for the next question
    replenishPromptCache('Product Sense', recentMistakes);
    
    setCarState('reading_prompt');
    speak(`Next question: ${prompt.prompt}. Take your time. Say "I am done" when you finish.`, () => {
      startListeningForAnswer(prompt);
    });
  };

  const processAnswer = async (answer: string, promptObj?: {prompt: string, mode: InterviewMode}) => {
    if (stateRef.current === 'evaluating') return;
    
    const activePrompt = promptObj || currentPrompt;
    if (!activePrompt || !answer.trim()) {
      handleNextQuestion();
      return;
    }

    setCarState('evaluating');
    speak("Got it. Evaluating your answer...");
    
    const timeTaken = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const userName = auth.currentUser?.displayName?.split(' ')[0] || 'User';

    try {
      const evaluation = await evaluateAnswer(
        activePrompt.prompt,
        answer,
        'Product Sense',
        timeTaken,
        { recentMistakes, recentStrengths: [], userName }
      );

      const rep: DrillRep = {
        id: uuidv4(),
        prompt: activePrompt.prompt,
        expectedMode: evaluation.expectedMode as InterviewMode || activePrompt.mode,
        userSelectedMode: 'Product Sense',
        userAnswer: answer,
        timeTakenSeconds: timeTaken,
        critique: evaluation.critique || 'No critique provided.',
        correctedAnswer: evaluation.correctedAnswer || '',
        mistakeTags: evaluation.mistakeTags || [],
        strengthTags: evaluation.strengthTags || [],
        microLesson: evaluation.microLesson || '',
        scores: evaluation.scores || {},
        retryPrompt: evaluation.retryPrompt || '',
      };

      const updatedSession = {
        ...session,
        reps: [...session.reps, rep]
      };
      
      setSession(updatedSession);
      updateSession(updatedSession);
      saveRep(rep, session.id);

      setCarState('reading_feedback');
      const feedbackText = `Here is your feedback. ${rep.critique} Lesson: ${rep.microLesson}. Say "Next" to move to the next question, or "End Session" to finish.`;
      
      const listenForCommand = () => {
        setCarState('listening_command');
        startListening((text) => {
          const cmd = text.toLowerCase();
          if (cmd.includes('next')) {
            stopListening();
            handleNextQuestion();
          } else if (cmd.includes('end') || cmd.includes('stop') || cmd.includes('finish')) {
            handleEndSession();
          } else if (cmd.includes('repeat') || cmd.includes('say that again')) {
            stopListening();
            speak(feedbackText, listenForCommand);
          }
        });
      };

      speak(feedbackText, listenForCommand);

    } catch (error) {
      console.error(error);
      speak("Sorry, I had trouble evaluating that. Let's try another question.", () => {
        handleNextQuestion();
      });
    }
  };

  const startCarMode = () => {
    handleNextQuestion();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] bg-zinc-900 rounded-3xl p-8 text-white relative overflow-hidden">
      <div className="absolute top-6 right-6">
        <button 
          onClick={handleEndSession}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-full text-sm font-medium transition-colors"
        >
          <StopCircle className="w-4 h-4" />
          End Drive
        </button>
      </div>

      <div className="flex flex-col items-center max-w-2xl text-center space-y-8 z-10">
        <div className="p-6 bg-zinc-800 rounded-full mb-4">
          <Car className="w-16 h-16 text-blue-400" />
        </div>

        {state === 'idle' ? (
          <>
            <h2 className="text-4xl font-bold tracking-tight">Car Mode</h2>
            <p className="text-xl text-zinc-400">Hands-free Product Sense practice.</p>
            <button 
              onClick={startCarMode}
              className="mt-8 px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-semibold text-lg transition-colors shadow-lg shadow-blue-900/20"
            >
              Start Driving Session
            </button>
          </>
        ) : (
          <div className="space-y-8 w-full">
            <div className="flex justify-center">
              {state === 'listening_answer' || state === 'listening_command' ? (
                <div className="relative">
                  <div className="absolute inset-0 bg-blue-500 rounded-full animate-ping opacity-20"></div>
                  <div className="p-8 bg-blue-600 rounded-full relative">
                    <Mic className="w-12 h-12 text-white" />
                  </div>
                </div>
              ) : state === 'evaluating' ? (
                <div className="p-8 bg-amber-600 rounded-full">
                  <Loader2 className="w-12 h-12 text-white animate-spin" />
                </div>
              ) : (
                <div className="p-8 bg-zinc-700 rounded-full">
                  <MicOff className="w-12 h-12 text-zinc-400" />
                </div>
              )}
            </div>

            <div className="h-32 flex flex-col items-center justify-center">
              <h3 className="text-2xl font-semibold text-blue-400 mb-2">
                {state === 'reading_prompt' && "Reading Prompt..."}
                {state === 'listening_answer' && (silenceCounter > 0 ? `Waiting for your response... (${silenceCounter}s)` : "Listening...")}
                {state === 'evaluating' && "Evaluating..."}
                {state === 'reading_feedback' && "Reading Feedback..."}
                {state === 'listening_command' && "Say 'Next' or 'End Session'"}
                {state === 'asking_if_done' && "Are you done with your answer?"}
              </h3>
              
              {state === 'listening_answer' && transcript && (
                <p className="text-lg text-zinc-300 italic max-w-lg truncate">
                  "{transcript}"
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
