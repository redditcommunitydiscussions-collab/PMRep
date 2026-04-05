import { useState } from 'react';
import { useStore } from './lib/store';
import { InterviewMode, DrillSession } from './types';
import { Dashboard } from './components/Dashboard';
import { DrillScreen } from './components/DrillScreen';
import { CarModeScreen } from './components/CarModeScreen';
import { AuthWrapper } from './components/AuthWrapper';
import { auth } from './firebase';

function MainApp() {
  const { sessions, saveSession, getRecentMistakes, getRecentStrengths } = useStore();
  const [currentMode, setCurrentMode] = useState<InterviewMode | 'Mixed' | 'CarMode' | null>(null);

  const handleStartDrill = (mode: InterviewMode | 'Mixed' | 'CarMode') => {
    setCurrentMode(mode);
  };

  const handleEndDrill = () => {
    setCurrentMode(null);
  };

  const userName = auth.currentUser?.displayName?.split(' ')[0] || 'User';

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans">
      <header className="bg-white border-b border-zinc-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-800">
          PM Interview Coach <span className="text-zinc-400 font-normal text-sm ml-2">for {userName}</span>
        </h1>
        <div className="flex items-center gap-4">
          {currentMode && (
            <button 
              onClick={() => setCurrentMode(null)}
              className="text-sm font-medium text-zinc-500 hover:text-zinc-800 transition-colors"
            >
              End Session
            </button>
          )}
          <button 
            onClick={() => auth.signOut()}
            className="text-sm font-medium text-zinc-500 hover:text-zinc-800 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6">
        {currentMode === 'CarMode' ? (
          <CarModeScreen 
            onEndSession={handleEndDrill} 
            recentMistakes={getRecentMistakes().map(m => m.tag)}
          />
        ) : currentMode ? (
          <DrillScreen 
            mode={currentMode as InterviewMode | 'Mixed'} 
            onEndSession={handleEndDrill} 
            recentMistakes={getRecentMistakes().map(m => m.tag)}
          />
        ) : (
          <Dashboard 
            sessions={sessions} 
            recentMistakes={getRecentMistakes()}
            recentStrengths={getRecentStrengths()}
            onStartDrill={handleStartDrill} 
          />
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthWrapper>
      <MainApp />
    </AuthWrapper>
  );
}
