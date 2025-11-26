import React, { useState } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { AppStep, CandidateInfo, InterviewResult } from './types';
import { CandidateForm } from './components/CandidateForm';
import { Instructions } from './components/Instructions';
import { InterviewSession } from './components/InterviewSession';
import { ResultScreen } from './components/ResultScreen';

const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>(AppStep.FORM);
  const [candidate, setCandidate] = useState<CandidateInfo | null>(null);
  const [result, setResult] = useState<InterviewResult | null>(null);

  const handleFormSubmit = (info: CandidateInfo) => {
    // Ye step change karega aur Instructions screen dikhayega
    setCandidate(info);
    setStep(AppStep.INSTRUCTIONS);
  };

  const startInterview = () => {
    setStep(AppStep.INTERVIEW);
  };

  const handleInterviewComplete = async (transcript: string, terminationReason?: string) => {
    setStep(AppStep.EVALUATING);
    
    // Disqualification check
    if (terminationReason && terminationReason !== "Completed") {
        setTimeout(() => {
            setResult({
                rating: 0,
                feedback: "Interview terminated early by proctoring system.",
                passed: false,
                questions: [],
                terminationReason: terminationReason
            });
            setStep(AppStep.RESULT);
        }, 1500);
        return;
    }
    
    // AI Evaluation (Shortened for stability, add API logic back if needed)
    try {
      const apiKey = process.env.API_KEY;
      // Fallback simple result if no API key for testing UI
      if (!apiKey) {
          console.warn("No API Key found, showing dummy result");
          setTimeout(() => {
            setResult({ rating: 7, feedback: "Great interview (Demo Mode).", passed: true, questions: [] });
            setStep(AppStep.RESULT);
          }, 2000);
          return;
      }

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Evaluate candidate ${candidate?.name} for ${candidate?.field}. Transcript: ${transcript}. Return JSON with rating(1-10), feedback, questions array.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              rating: { type: Type.INTEGER },
              feedback: { type: Type.STRING },
              questions: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { question: {type:Type.STRING}, rating: {type:Type.INTEGER}, feedback: {type:Type.STRING}, candidateAnswerSummary: {type:Type.STRING} } } }
            }
          }
        }
      });
      
      const data = JSON.parse(response.text || '{}');
      setResult({
        rating: data.rating || 0,
        feedback: data.feedback || "Evaluation complete.",
        passed: (data.rating || 0) > 6,
        questions: data.questions || []
      });
      setStep(AppStep.RESULT);

    } catch (error) {
      console.error("Evaluation Error", error);
      setResult({ rating: 0, feedback: "Evaluation failed.", passed: false, questions: [] });
      setStep(AppStep.RESULT);
    }
  };

  const resetApp = () => {
    setCandidate(null);
    setResult(null);
    setStep(AppStep.FORM);
  };

  const showHeader = step !== AppStep.INTERVIEW;
  const isLightBackground = step === AppStep.RESULT;

  return (
    <div className="h-[100dvh] w-screen overflow-hidden font-sans text-slate-900 bg-slate-50 flex flex-col relative">
      
      {/* Header */}
      {showHeader && (
        <header className="absolute top-0 left-0 w-full z-50 px-6 py-4 pointer-events-none">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3 pointer-events-auto">
               <img src="/interna.png" alt="Interna" className="w-8 h-8 object-contain" onError={(e) => e.currentTarget.style.display='none'} />
               <h1 className={`text-xl font-bold tracking-tight ${isLightBackground ? 'text-slate-900' : 'text-white'}`}>
                 Interna
               </h1>
            </div>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main className="flex-1 w-full relative overflow-hidden">
          {step === AppStep.FORM && (
            <CandidateForm onSubmit={handleFormSubmit} />
          )}

          {step === AppStep.INSTRUCTIONS && (
            <Instructions onStart={startInterview} />
          )}

          {step === AppStep.INTERVIEW && candidate && (
            <InterviewSession candidate={candidate} onComplete={handleInterviewComplete} />
          )}

          {step === AppStep.EVALUATING && (
             <div className="h-full w-full flex flex-col items-center justify-center bg-slate-900 text-white">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-indigo-500 mb-4"></div>
                <h2 className="text-2xl font-bold">Interna is Analyzing...</h2>
             </div>
          )}

          {step === AppStep.RESULT && result && candidate && (
            <ResultScreen result={result} candidateName={candidate.name} onReset={resetApp} />
          )}
      </main>
      
      {/* Footer */}
      {showHeader && (
         <footer className="absolute bottom-1 w-full text-center py-2 z-40 pointer-events-none">
            <p className={`text-[10px] font-bold uppercase tracking-widest ${isLightBackground ? 'text-slate-400' : 'text-slate-600'}`}>
                Interna by Internadda
            </p>
         </footer>
      )}
    </div>
  );
};

export default App;
