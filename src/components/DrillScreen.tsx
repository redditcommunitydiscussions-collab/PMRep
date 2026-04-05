import { useState, useEffect, useRef } from 'react';
import { InterviewMode, DrillSession, DrillRep, WeaknessTag, StrengthTag } from '../types';
import { getInstantPrompt, replenishPromptCache } from '../lib/prompts';
import { evaluateAnswer, evaluateRetry } from '../lib/gemini';
import { useStore } from '../lib/store';
import { v4 as uuidv4 } from 'uuid';
import { Play, Square, RefreshCw, CheckCircle2, AlertCircle, Clock, Brain, BarChart2, Users, Mic, MicOff, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { auth } from '../firebase';

const LOADING_MESSAGES = [
  "Analyzing your structure...",
  "Checking for concrete details...",
  "Evaluating product sense...",
  "Reviewing metric selection...",
  "Synthesizing feedback..."
];

interface DrillScreenProps {
  mode: InterviewMode | 'Mixed';
  onEndSession: () => void;
  recentMistakes: WeaknessTag[];
}

export function DrillScreen({ mode, onEndSession, recentMistakes }: DrillScreenProps) {
  const { saveSession, updateSession, saveRep, updateRep, getRecentStrengths } = useStore();
  const [session, setSession] = useState<DrillSession>({
    id: uuidv4(),
    date: new Date().toISOString(),
    mode,
    reps: [],
  });
  
  const [currentPrompt, setCurrentPrompt] = useState<{ prompt: string; mode: InterviewMode } | null>(null);
  const [userAnswer, setUserAnswer] = useState('');
  const [selectedMode, setSelectedMode] = useState<InterviewMode>('Product Sense');
  const [isAnswering, setIsAnswering] = useState(false);
  const [timeTaken, setTimeTaken] = useState(0);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [currentRep, setCurrentRep] = useState<DrillRep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [loadingMessageIdx, setLoadingMessageIdx] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryAnswer, setRetryAnswer] = useState('');
  const [isCritiqueOpen, setIsCritiqueOpen] = useState(true);

  const timerRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    let interval: number;
    if (isEvaluating) {
      interval = window.setInterval(() => {
        setLoadingMessageIdx(i => (i + 1) % LOADING_MESSAGES.length);
      }, 2000);
    } else {
      setLoadingMessageIdx(0);
    }
    return () => clearInterval(interval);
  }, [isEvaluating]);

  useEffect(() => {
    saveSession(session);
    startNewRep();
    
    // Pre-fill cache for mixed mode or current mode
    const modesToReplenish: InterviewMode[] = mode === 'Mixed' 
      ? ['Product Sense', 'Analytics', 'Leadership / Behavioral']
      : [mode];
    modesToReplenish.forEach(m => replenishPromptCache(m, recentMistakes));
    
    return () => {
      stopTimer();
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
    } else {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert("Speech recognition is not supported in this browser.");
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      
      recognition.onresult = (event: any) => {
        let newTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          newTranscript += event.results[i][0].transcript;
        }
        if (isRetrying) {
          setRetryAnswer(prev => prev + (prev && !prev.endsWith(' ') ? ' ' : '') + newTranscript);
        } else {
          setUserAnswer(prev => prev + (prev && !prev.endsWith(' ') ? ' ' : '') + newTranscript);
        }
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognition.start();
      recognitionRef.current = recognition;
      setIsRecording(true);
    }
  };

  const startNewRep = () => {
    setError(null);
    
    const targetMode = mode === 'Mixed' 
      ? (['Product Sense', 'Analytics', 'Leadership / Behavioral'][Math.floor(Math.random() * 3)] as InterviewMode)
      : mode;
      
    const next = getInstantPrompt(targetMode);

    setCurrentPrompt(next);
    setUserAnswer('');
    setSelectedMode(targetMode);
    setIsAnswering(true);
    setTimeTaken(0);
    setCurrentRep(null);
    setIsRetrying(false);
    setRetryAnswer('');
    setIsCritiqueOpen(true);
    startTimer();
    
    // Fire background replenishment
    replenishPromptCache(targetMode, recentMistakes);
  };

  const startTimer = () => {
    stopTimer();
    timerRef.current = window.setInterval(() => {
      setTimeTaken(t => t + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleSubmit = async () => {
    if (!userAnswer.trim() || !currentPrompt) return;
    
    if (isRecording) {
      toggleRecording();
    }
    
    stopTimer();
    setIsAnswering(false);
    setIsEvaluating(true);
    setError(null);

    try {
      const recentStrengths = getRecentStrengths().map(s => s.tag);
      const userName = auth.currentUser?.displayName?.split(' ')[0] || 'User';
      const evaluation = await evaluateAnswer(
        currentPrompt.prompt,
        userAnswer,
        selectedMode,
        timeTaken,
        {
          recentMistakes,
          recentStrengths,
          userName
        }
      );

      const rep: DrillRep = {
        id: uuidv4(),
        prompt: currentPrompt.prompt,
        expectedMode: evaluation.expectedMode as InterviewMode || currentPrompt.mode,
        userSelectedMode: selectedMode,
        userAnswer,
        timeTakenSeconds: timeTaken,
        critique: evaluation.critique || 'No critique provided.',
        correctedAnswer: evaluation.correctedAnswer || '',
        mistakeTags: evaluation.mistakeTags || [],
        strengthTags: evaluation.strengthTags || [],
        microLesson: evaluation.microLesson || '',
        scores: evaluation.scores || {},
        retryPrompt: evaluation.retryPrompt || '',
      };

      setCurrentRep(rep);
      
      const updatedSession = {
        ...session,
        reps: [...session.reps, rep]
      };
      
      setSession(updatedSession);
      updateSession(updatedSession);
      saveRep(rep, session.id);
    } catch (err) {
      console.error(err);
      setError('Failed to evaluate answer. Please try again.');
      setIsAnswering(true);
      startTimer();
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleRetrySubmit = async () => {
    if (!retryAnswer.trim() || !currentPrompt || !currentRep) return;
    
    if (isRecording) {
      toggleRecording();
    }
    
    stopTimer();
    setIsRetrying(false);
    setIsEvaluating(true);
    setError(null);

    try {
      const userName = auth.currentUser?.displayName?.split(' ')[0] || 'User';
      const retryEval = await evaluateRetry(
        currentPrompt.prompt,
        currentRep.userAnswer,
        retryAnswer,
        userName
      );

      const updatedRep: DrillRep = {
        ...currentRep,
        retryAnswer,
        retryComparison: retryEval.comparison,
        retryRemainingGap: retryEval.remainingGap,
        correctedAnswer: retryEval.correctedAnswer,
        retryMistakeTags: (retryEval.retryMistakeTags || []) as WeaknessTag[],
        retryStrengthTags: (retryEval.retryStrengthTags || []) as StrengthTag[],
        retryScores: retryEval.retryScores || {},
      };

      setCurrentRep(updatedRep);
      setIsCritiqueOpen(false);
      
      const updatedSession = {
        ...session,
        reps: session.reps.map(r => r.id === updatedRep.id ? updatedRep : r)
      };
      
      setSession(updatedSession);
      updateSession(updatedSession);
      updateRep(updatedRep, session.id);
    } catch (err) {
      console.error(err);
      setError('Failed to evaluate retry. Please try again.');
      setIsRetrying(true);
      startTimer();
    } finally {
      setIsEvaluating(false);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (!currentPrompt) return null;

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
            Rep {session.reps.length + (currentRep ? 0 : 1)}
          </span>
          <div className="flex items-center gap-2 text-zinc-500 font-mono bg-zinc-100 px-3 py-1 rounded-full text-sm">
            <Clock className="w-4 h-4" />
            {formatTime(timeTaken)}
          </div>
        </div>
        <h2 className="text-2xl font-semibold text-zinc-900 leading-tight">
          {currentPrompt.prompt}
        </h2>
      </div>

      {isAnswering && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {(['Product Sense', 'Analytics', 'Leadership / Behavioral'] as InterviewMode[]).map(m => (
              <button
                key={m}
                onClick={() => setSelectedMode(m)}
                className={cn(
                  "px-4 py-2 rounded-xl text-sm font-medium border transition-colors",
                  selectedMode === m 
                    ? "bg-zinc-900 text-white border-zinc-900" 
                    : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50"
                )}
              >
                {m === 'Product Sense' && <Brain className="w-4 h-4 inline-block mr-2 -mt-0.5" />}
                {m === 'Analytics' && <BarChart2 className="w-4 h-4 inline-block mr-2 -mt-0.5" />}
                {m === 'Leadership / Behavioral' && <Users className="w-4 h-4 inline-block mr-2 -mt-0.5" />}
                {m}
              </button>
            ))}
          </div>

          <div className="relative">
            <textarea
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              placeholder="Type or speak your answer here... (Keep it tight. 4-5 sentences max.)"
              className="w-full h-48 p-4 bg-white border border-zinc-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-zinc-900 focus:border-zinc-900 resize-none text-zinc-800 text-lg leading-relaxed"
              autoFocus
            />
            <button
              onClick={toggleRecording}
              className={cn(
                "absolute bottom-4 right-4 p-3 rounded-full shadow-sm transition-all",
                isRecording 
                  ? "bg-red-500 text-white hover:bg-red-600 animate-pulse" 
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              )}
              title={isRecording ? "Stop recording" : "Start recording"}
            >
              {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          </div>

          {error && (
            <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              onClick={() => onEndSession()}
              className="px-6 py-3 rounded-xl font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
            >
              End Session
            </button>
            <button
              onClick={handleSubmit}
              disabled={!userAnswer.trim() || isEvaluating}
              className="px-6 py-3 bg-zinc-900 text-white rounded-xl font-medium hover:bg-zinc-800 transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
            >
              {isEvaluating ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Evaluating...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  Submit Answer
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {isEvaluating && (
        <div className="bg-white p-12 rounded-2xl border border-zinc-200 shadow-sm flex flex-col items-center justify-center space-y-6 animate-in fade-in duration-500">
          <RefreshCw className="w-10 h-10 animate-spin text-zinc-400" />
          <p className="text-zinc-600 font-medium text-lg animate-pulse">
            {LOADING_MESSAGES[loadingMessageIdx]}
          </p>
        </div>
      )}

      {currentRep && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          
          <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm space-y-6">
            
            <details 
              open={isCritiqueOpen}
              onToggle={(e) => setIsCritiqueOpen((e.target as HTMLDetailsElement).open)}
              className="group"
            >
              <summary className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-2 cursor-pointer hover:text-zinc-600 list-none flex items-center gap-2 outline-none">
                Initial Critique
                <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-6 mt-4">
                <div>
                  <p className="text-lg font-medium text-zinc-900 leading-relaxed">
                    {currentRep.critique}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {currentRep.mistakeTags.map(tag => (
                    <span key={tag} className="px-3 py-1 bg-red-50 text-red-700 border border-red-100 rounded-lg text-xs font-mono">
                      {tag}
                    </span>
                  ))}
                  {currentRep.strengthTags.map(tag => (
                    <span key={tag} className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg text-xs font-mono">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="pt-4 border-t border-zinc-100">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                      <Brain className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-900">Micro Lesson</h3>
                      <p className="text-zinc-600">{currentRep.microLesson}</p>
                    </div>
                  </div>
                </div>
              </div>
            </details>

            {currentRep.retryAnswer ? (
              <div className="space-y-6 pt-4 border-t border-zinc-100">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-2">Retry Feedback</h3>
                  <p className="text-zinc-800 leading-relaxed font-medium">
                    {currentRep.retryComparison}
                  </p>
                  {currentRep.retryRemainingGap && (
                    <p className="text-red-600 leading-relaxed mt-2 text-sm">
                      <AlertCircle className="w-4 h-4 inline mr-1 -mt-0.5" />
                      {currentRep.retryRemainingGap}
                    </p>
                  )}
                  
                  {(currentRep.retryMistakeTags?.length || 0) > 0 || (currentRep.retryStrengthTags?.length || 0) > 0 ? (
                    <div className="flex flex-wrap gap-2 mt-4">
                      {currentRep.retryMistakeTags?.map(tag => (
                        <span key={tag} className="px-3 py-1 bg-red-50 text-red-700 border border-red-100 rounded-lg text-xs font-mono">
                          {tag}
                        </span>
                      ))}
                      {currentRep.retryStrengthTags?.map(tag => (
                        <span key={tag} className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg text-xs font-mono">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="bg-zinc-50 p-5 rounded-xl border border-zinc-100">
                  <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-2">Tighter Version</h3>
                  <p className="text-zinc-800 leading-relaxed">
                    {currentRep.correctedAnswer}
                  </p>
                </div>
              </div>
            ) : isRetrying ? (
              <div className="space-y-4 pt-4 border-t border-zinc-100">
                <div className="bg-amber-50 p-4 rounded-xl border border-amber-100 text-amber-800">
                  <h3 className="text-sm font-semibold uppercase tracking-wider mb-1 flex items-center gap-2">
                    <RefreshCw className="w-4 h-4" />
                    Retry Prompt
                  </h3>
                  <p>{currentRep.retryPrompt}</p>
                </div>
                <div className="relative">
                  <textarea
                    value={retryAnswer}
                    onChange={(e) => setRetryAnswer(e.target.value)}
                    placeholder="Type or speak your shorter, clearer second attempt here..."
                    className="w-full h-32 p-4 bg-white border border-zinc-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-zinc-900 focus:border-zinc-900 resize-none text-zinc-800 text-lg leading-relaxed"
                    autoFocus
                  />
                  <button
                    onClick={toggleRecording}
                    className={cn(
                      "absolute bottom-4 right-4 p-3 rounded-full shadow-sm transition-all",
                      isRecording 
                        ? "bg-red-500 text-white hover:bg-red-600 animate-pulse" 
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                    )}
                    title={isRecording ? "Stop recording" : "Start recording"}
                  >
                    {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>
                </div>
                {error && (
                  <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    {error}
                  </div>
                )}
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => {
                      if (isRecording) toggleRecording();
                      setIsRetrying(false);
                    }}
                    className="px-6 py-3 rounded-xl font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
                  >
                    Cancel Retry
                  </button>
                  <button
                    onClick={handleRetrySubmit}
                    disabled={!retryAnswer.trim() || isEvaluating}
                    className="px-6 py-3 bg-zinc-900 text-white rounded-xl font-medium hover:bg-zinc-800 transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
                  >
                    Submit Retry
                  </button>
                </div>
                
                <details className="group mt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-zinc-500 hover:text-zinc-800 uppercase tracking-wider flex items-center gap-2 select-none transition-colors">
                    <span className="group-open:hidden">▶ Show Example Answer</span>
                    <span className="hidden group-open:inline">▼ Hide Example Answer</span>
                  </summary>
                  <div className="bg-zinc-50 p-5 rounded-xl border border-zinc-100 mt-3">
                    <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-2">Tighter Version</h3>
                    <p className="text-zinc-800 leading-relaxed">
                      {currentRep.correctedAnswer}
                    </p>
                  </div>
                </details>
              </div>
            ) : currentRep.retryPrompt ? (
              <div className="pt-4 border-t border-zinc-100">
                <div className="bg-amber-50 p-4 rounded-xl border border-amber-100 text-amber-800 mb-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wider mb-1 flex items-center gap-2">
                    <RefreshCw className="w-4 h-4" />
                    Retry Available
                  </h3>
                  <p>{currentRep.retryPrompt}</p>
                </div>
                <div className="flex justify-end mb-4">
                  <button
                    onClick={() => setIsRetrying(true)}
                    className="px-6 py-3 bg-amber-100 text-amber-800 rounded-xl font-medium hover:bg-amber-200 transition-colors flex items-center gap-2 shadow-sm"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Retry Answer
                  </button>
                </div>
                
                <details className="group">
                  <summary className="cursor-pointer text-sm font-semibold text-zinc-500 hover:text-zinc-800 uppercase tracking-wider flex items-center gap-2 select-none transition-colors">
                    <span className="group-open:hidden">▶ Show Example Answer</span>
                    <span className="hidden group-open:inline">▼ Hide Example Answer</span>
                  </summary>
                  <div className="bg-zinc-50 p-5 rounded-xl border border-zinc-100 mt-3">
                    <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-2">Tighter Version</h3>
                    <p className="text-zinc-800 leading-relaxed">
                      {currentRep.correctedAnswer}
                    </p>
                  </div>
                </details>
              </div>
            ) : (
              <div className="bg-zinc-50 p-5 rounded-xl border border-zinc-100">
                <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-2">Tighter Version</h3>
                <p className="text-zinc-800 leading-relaxed">
                  {currentRep.correctedAnswer}
                </p>
              </div>
            )}

          </div>

          {!isRetrying && (
            <div className="flex justify-end gap-3">
              <button
                onClick={() => onEndSession()}
                className="px-6 py-3 rounded-xl font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
              >
                End Session
              </button>
              <button
                onClick={startNewRep}
                className="px-6 py-3 bg-zinc-900 text-white rounded-xl font-medium hover:bg-zinc-800 transition-colors flex items-center gap-2 shadow-sm"
              >
                Next Rep
                <Play className="w-4 h-4" />
              </button>
            </div>
          )}

        </div>
      )}

    </div>
  );
}
