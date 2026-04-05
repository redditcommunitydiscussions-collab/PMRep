import React, { useState, useEffect } from 'react';
import { InterviewMode, DrillSession, WeaknessTag, StrengthTag } from '../types';
import { Play, Brain, BarChart2, Users, Zap, AlertCircle, CheckCircle2, MessageSquare, Car } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { GoogleGenAI } from '@google/genai';
import { auth } from '../firebase';

interface DashboardProps {
  sessions: DrillSession[];
  recentMistakes: { tag: WeaknessTag; count: number }[];
  recentStrengths: { tag: StrengthTag; count: number }[];
  onStartDrill: (mode: InterviewMode | 'Mixed' | 'CarMode') => void;
}

export function Dashboard({ sessions, recentMistakes, recentStrengths, onStartDrill }: DashboardProps) {
  const [coachAssessment, setCoachAssessment] = useState<string | null>(null);
  const [isLoadingAssessment, setIsLoadingAssessment] = useState(false);

  const chartData = sessions.slice().reverse().flatMap(s => 
    s.reps.flatMap((rep, i) => {
      const dataPoints = [];
      const dateStr = format(new Date(s.date), 'MMM d');
      
      // Initial score
      const initialScores = Object.values(rep.scores || {}).filter(v => typeof v === 'number') as number[];
      const initialAvg = initialScores.length > 0 ? initialScores.reduce((a, b) => a + b, 0) / initialScores.length : 0;
      if (initialAvg > 0) {
        dataPoints.push({
          name: `${dateStr} - Rep ${i + 1}`,
          date: dateStr,
          repIndex: i + 1,
          score: Number(initialAvg.toFixed(1)),
          prompt: rep.prompt.substring(0, 30) + '...'
        });
      }

      // Retry score
      if (rep.retryScores && Object.keys(rep.retryScores).length > 0) {
        const retryScores = Object.values(rep.retryScores).filter(v => typeof v === 'number') as number[];
        const retryAvg = retryScores.length > 0 ? retryScores.reduce((a, b) => a + b, 0) / retryScores.length : 0;
        if (retryAvg > 0) {
          dataPoints.push({
            name: `${dateStr} - Rep ${i + 1} (Retry)`,
            date: dateStr,
            repIndex: i + 1,
            score: Number(retryAvg.toFixed(1)),
            prompt: rep.prompt.substring(0, 30) + '...'
          });
        }
      }

      return dataPoints;
    })
  );

  useEffect(() => {
    // Only generate assessment if we have enough data and haven't generated it recently
    if (sessions.length > 0 && !coachAssessment && !isLoadingAssessment) {
      generateAssessment();
    }
  }, [sessions]);

  const generateAssessment = async () => {
    setIsLoadingAssessment(true);
    try {
      const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || (process as any).env?.GEMINI_API_KEY || '';
      const ai = new GoogleGenAI({ apiKey });
      
      const mistakesStr = recentMistakes.map(m => `${m.tag} (${m.count} times)`).join(', ');
      const strengthsStr = recentStrengths.map(s => `${s.tag} (${s.count} times)`).join(', ');
      const avgScore = chartData.length > 0 
        ? (chartData.reduce((acc, curr) => acc + curr.score, 0) / chartData.length).toFixed(1)
        : 'N/A';

      const userName = auth.currentUser?.displayName?.split(' ')[0] || 'User';

      const prompt = `You are an expert PM Interview Coach for ${userName}.
Based on their recent drill data, write a short, punchy, 2-3 sentence personalized assessment of where they stand right now and what they should focus on today.
Speak directly to them ("${userName}, you've been doing great at...").
Be honest, direct, and practical. No fluff.

Data:
- Average Score: ${avgScore}/5
- Frequent Strengths: ${strengthsStr || 'None yet'}
- Frequent Weaknesses: ${mistakesStr || 'None yet'}
- Total Reps Completed: ${chartData.length}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });

      setCoachAssessment(response.text || "Keep practicing to generate a personalized assessment.");
    } catch (error) {
      console.error("Failed to generate assessment:", error);
      setCoachAssessment("Keep practicing to generate a personalized assessment.");
    } finally {
      setIsLoadingAssessment(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Coach's Assessment Section */}
      <section className="bg-zinc-900 text-white p-6 rounded-2xl shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 opacity-10">
          <Brain className="w-32 h-32" />
        </div>
        <div className="relative z-10">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2 text-zinc-300">
            <MessageSquare className="w-5 h-5" />
            Coach's Assessment
          </h2>
          {isLoadingAssessment ? (
            <div className="animate-pulse flex space-x-4">
              <div className="flex-1 space-y-3 py-1">
                <div className="h-4 bg-zinc-700 rounded w-3/4"></div>
                <div className="h-4 bg-zinc-700 rounded w-5/6"></div>
              </div>
            </div>
          ) : (
            <p className="text-lg leading-relaxed text-zinc-100 max-w-3xl">
              {coachAssessment || "Complete a few drills to get your personalized assessment."}
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-4 text-zinc-900">Start Training</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <DrillCard 
            title="Product Sense" 
            icon={<Brain className="w-5 h-5" />} 
            description="1 user, 1 problem, 1 feature, 2 details."
            onClick={() => onStartDrill('Product Sense')}
            color="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
          />
          <DrillCard 
            title="Analytics" 
            icon={<BarChart2 className="w-5 h-5" />} 
            description="Define, break down, debug."
            onClick={() => onStartDrill('Analytics')}
            color="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
          />
          <DrillCard 
            title="Leadership" 
            icon={<Users className="w-5 h-5" />} 
            description="STAR format, real execution."
            onClick={() => onStartDrill('Leadership / Behavioral')}
            color="bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100"
          />
          <DrillCard 
            title="Mixed Mode" 
            icon={<Zap className="w-5 h-5" />} 
            description="Rapid mode switching drills."
            onClick={() => onStartDrill('Mixed')}
            color="bg-zinc-100 text-zinc-800 border-zinc-300 hover:bg-zinc-200"
          />
          <DrillCard 
            title="Car Mode" 
            icon={<Car className="w-5 h-5" />} 
            description="Hands-free voice practice."
            onClick={() => onStartDrill('CarMode')}
            color="bg-zinc-900 text-white border-zinc-800 hover:bg-zinc-800"
          />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <section className="lg:col-span-2 bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
          <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-zinc-400" />
            Improvement Trend
          </h2>
          <div className="h-64">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#71717a', fontSize: 12}} 
                    tickFormatter={(value) => value.split(' - ')[0]}
                    dy={10} 
                    minTickGap={30}
                  />
                  <YAxis domain={[1, 5]} axisLine={false} tickLine={false} tick={{fill: '#71717a', fontSize: 12}} dx={-10} />
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-white p-3 rounded-xl shadow-lg border border-zinc-100 text-sm">
                            <p className="font-semibold text-zinc-900 mb-1">{data.date} (Rep {data.repIndex})</p>
                            <p className="text-zinc-500 mb-2 max-w-[200px] truncate">{data.prompt}</p>
                            <p className="text-zinc-900 font-medium">Score: {data.score}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="score" 
                    stroke="#18181b" 
                    strokeWidth={3} 
                    dot={{r: 4, fill: '#18181b'}} 
                    activeDot={{r: 6}} 
                    isAnimationActive={chartData.length > 1}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-400 text-sm">
                Complete sessions to see your progress.
              </div>
            )}
          </div>
        </section>

        <section className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              Recent Mistakes
            </h2>
            {recentMistakes.length > 0 ? (
              <ul className="space-y-3">
                {recentMistakes.map((m, i) => (
                  <li key={i} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs bg-red-50 text-red-700 px-2 py-1 rounded-md border border-red-100">
                      {m.tag}
                    </span>
                    <span className="text-zinc-500 font-medium">{m.count} reps</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">No data yet.</p>
            )}
          </div>

          <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="w-5 h-5" />
              Recent Strengths
            </h2>
            {recentStrengths.length > 0 ? (
              <ul className="space-y-3">
                {recentStrengths.map((s, i) => (
                  <li key={i} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-md border border-emerald-100">
                      {s.tag}
                    </span>
                    <span className="text-zinc-500 font-medium">{s.count} reps</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">No data yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function DrillCard({ title, icon, description, onClick, color }: { title: string, icon: React.ReactNode, description: string, onClick: () => void, color: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-start p-5 rounded-2xl border transition-all duration-200 text-left ${color}`}
    >
      <div className="mb-3 p-2 bg-white/50 rounded-lg">
        {icon}
      </div>
      <h3 className="font-semibold text-lg mb-1">{title}</h3>
      <p className="text-sm opacity-80 leading-snug">{description}</p>
    </button>
  );
}
