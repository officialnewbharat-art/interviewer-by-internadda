import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, FunctionDeclaration } from '@google/genai';
import { CandidateInfo } from '../types';
import { createBlob, downsampleBuffer, decodeAudioData, decode } from '../utils/audio';

interface InterviewSessionProps {
  candidate: CandidateInfo;
  onComplete: (transcript: string, terminationReason?: string) => void;
}

const endInterviewTool: FunctionDeclaration = {
  name: "endInterview",
  description: "Ends the interview session. Call this when 5 questions are completed or the user requests to end.",
  parameters: {
    type: "OBJECT" as any,
    properties: {
      reason: { 
        type: "STRING" as any,
        description: "The reason for ending the interview."
      }
    },
    required: ["reason"]
  }
};

export const InterviewSession: React.FC<InterviewSessionProps> = ({ candidate, onComplete }) => {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [isMuted, setIsMuted] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcriptLines, setTranscriptLines] = useState<{speaker: 'user' | 'ai', text: string}[]>([]);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [silenceTriggered, setSilenceTriggered] = useState(false);
  const [systemMessageStatus, setSystemMessageStatus] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(600);

  // Refs (simplified for brevity, assume standard refs from original file exist)
  const isMountedRef = useRef<boolean>(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const inputGainRef = useRef<GainNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextAudioStartTimeRef = useRef<number>(0);
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const animationRef = useRef<number>(0);
  const terminationTriggeredRef = useRef<boolean>(false);
  const isConnectedRef = useRef<boolean>(false);
  const isAiSpeakingRef = useRef<boolean>(false);
  const mouthRef = useRef<SVGEllipseElement>(null);
  const lastUserSpeechTimeRef = useRef<number>(Date.now());
  const noiseFloorRef = useRef<number>(0.002); 
  const fullTranscriptHistory = useRef<string[]>([]);
  const isWaitingForResponseRef = useRef<boolean>(false);
  const lastAiTurnEndTimeRef = useRef<number>(0);
  const isProcessingTimeoutRef = useRef<boolean>(false);
  const silenceWarningCountRef = useRef<number>(0);

  // ... (Keep existing disconnect, handleTermination, timer, proctoring, and visualizer logic exactly as is) ...
  // [Assuming visualizer code block is here unchanged]

  const disconnect = () => {
    isConnectedRef.current = false;
    if (scriptProcessorRef.current) {
        scriptProcessorRef.current.onaudioprocess = null;
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current = null;
    }
    if (sessionRef.current) {
      try { sessionRef.current.close(); sessionRef.current = null; } catch (e) {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) audioContextRef.current.close();
    if (inputAudioContextRef.current) inputAudioContextRef.current.close();
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    sourcesRef.current.forEach(source => { try { source.stop(); } catch(e) {} });
    sourcesRef.current.clear();
  };

  const handleTermination = (reason: string) => {
      if (terminationTriggeredRef.current) return;
      terminationTriggeredRef.current = true;
      setTimeout(() => {
          disconnect();
          onComplete(fullTranscriptHistory.current.join('\n'), reason);
      }, 2000);
  };

  // Visualizer function (abbreviated)
  const drawVisualizer = () => {
      // ... same visualizer code ...
      const canvas = canvasRef.current;
      if (!canvas || !analyserRef.current) return;
      // ...
  };

  useEffect(() => {
    isMountedRef.current = true;

    const initSession = async () => {
      try {
        const apiKey = process.env.API_KEY;
        if (!apiKey) { setStatus('error'); return; }

        const ai = new GoogleGenAI({ apiKey });
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        
        // Audio Setup... (Keep existing setup)
        const audioContext = new AudioContextClass({ sampleRate: 24000 }); 
        audioContextRef.current = audioContext;
        const analyser = audioContext.createAnalyser();
        analyserRef.current = analyser;
        // ... (Visualizer setup) ...

        const inputAudioContext = new AudioContextClass();
        inputAudioContextRef.current = inputAudioContext;
        // ... (Input setup) ...
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: true });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        
        const source = inputAudioContext.createMediaStreamSource(stream);
        const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
        scriptProcessorRef.current = scriptProcessor;
        const inputGain = inputAudioContext.createGain();
        source.connect(inputGain);
        inputGain.connect(scriptProcessor);
        scriptProcessor.connect(inputAudioContext.destination);

        const sessionPromise = ai.live.connect({
          model: 'gemini-2.5-flash-native-audio-preview-09-2025',
          callbacks: {
            onopen: () => {
              if (!isMountedRef.current) return;
              setStatus('connected');
              isConnectedRef.current = true;
              
              scriptProcessor.onaudioprocess = (e) => {
                 // ... (Keep existing VAD and Send logic) ...
                 if (!isConnectedRef.current) return;
                 const inputData = e.inputBuffer.getChannelData(0);
                 // Simple VAD for brevity in this response
                 let sum = 0;
                 for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
                 const rms = Math.sqrt(sum / inputData.length);
                 if (rms > 0.02) {
                     lastUserSpeechTimeRef.current = Date.now();
                     setIsUserSpeaking(true);
                     isWaitingForResponseRef.current = false;
                 } else {
                     setIsUserSpeaking(false);
                 }
                 const downsampled = downsampleBuffer(inputData, inputAudioContext.sampleRate, 16000);
                 if (downsampled.length > 0) {
                     sessionPromise.then(s => s.sendRealtimeInput({ media: createBlob(downsampled, 16000) }));
                 }
              };
            },
            onmessage: async (message: LiveServerMessage) => {
                // ... (Keep existing message handling) ...
                if (message.toolCall) {
                   const call = message.toolCall.functionCalls?.find(f => f.name === 'endInterview');
                   if (call) handleTermination((call.args as any)?.reason || "Completed");
                }
                if (message.serverContent?.modelTurn?.parts?.[0]?.text) {
                    const text = message.serverContent.modelTurn.parts[0].text;
                    setTranscriptLines(prev => [...prev, {speaker: 'ai', text}]);
                    fullTranscriptHistory.current.push(`AI: ${text}`);
                    isAiSpeakingRef.current = true;
                }
                if (message.serverContent?.turnComplete) {
                    isAiSpeakingRef.current = false;
                    lastAiTurnEndTimeRef.current = Date.now();
                    isWaitingForResponseRef.current = true;
                }
                if (message.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
                    const audioData = message.serverContent.modelTurn.parts[0].inlineData.data;
                    const buffer = await decodeAudioData(decode(audioData), audioContext, 24000, 1);
                    const src = audioContext.createBufferSource();
                    src.buffer = buffer;
                    src.connect(audioContext.destination);
                    src.start(nextAudioStartTimeRef.current);
                    nextAudioStartTimeRef.current += buffer.duration;
                }
            },
            onerror: () => setStatus('error'),
          },
          config: {
            responseModalities: ["AUDIO" as any], 
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
            tools: [{ functionDeclarations: [endInterviewTool] }],
            systemInstruction: {
              parts: [{
                text: `You are Interna, developed by Internadda for interview.
                       Candidate Name: ${candidate.name}
                       Role: ${candidate.field}
                       Context: ${candidate.jobDescription.substring(0, 1000)}
                       Language: ${candidate.language}. SPEAK ONLY IN ${candidate.language}.

                       CORE IDENTITY:
                       - Your name is Interna.
                       - Your owner/creator is Internadda.
                       - You are a professional, impartial interviewer agent.

                       PROTOCOL:
                       1. **Introduction**: Briefly introduce yourself as Interna from Internadda and the role.
                       2. **The Interview Loop** (Execute exactly 5 times):
                          - Ask a technical question based on the Role/Context.
                          - **Listen Intelligently**:
                            - If the answer is correct: Acknowledge briefly and move to a HARDER question.
                            - If the answer is wrong: Briefly correct them and move to an EASIER question.
                       3. **Termination**: After 5 questions, say "This concludes our interview." and call 'endInterview'.
                       `
              }]
            }
          }
        });
        sessionRef.current = await sessionPromise;
      } catch (e) { setStatus('error'); }
    };
    initSession();
    // ... (Keep silence interval logic) ...
    return () => { isMountedRef.current = false; disconnect(); };
  }, []);

  const toggleMute = () => { /* ... */ };

  return (
    <div className="grid grid-rows-[auto_1fr_auto] h-full w-full bg-slate-950 text-white relative overflow-hidden">
      {/* 1. Header (Simplified for brevity) */}
      <div className="z-20 flex items-center justify-between px-6 py-4 bg-slate-900/50 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-4">
           {/* Status Badge */}
           <div className="flex items-center gap-2 px-3 py-1 rounded-full border bg-emerald-500/20 border-emerald-500/30 text-emerald-400">
               <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
               <span className="text-xs font-bold uppercase tracking-widest">{status}</span>
           </div>
           {/* Timer */}
           <div className="flex items-center gap-2 px-3 py-1 bg-slate-800 rounded-full">
              <span>{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</span>
           </div>
        </div>
      </div>

      {/* 2. Main Stage */}
      <div className="relative flex items-center justify-center overflow-hidden">
         {/* ... (Visualizer Canvas) ... */}
         <div className="relative z-10 flex flex-col items-center justify-center">
             {/* ... (Robot SVG) ... */}
             <div className="mt-8 text-center min-h-[24px]">
                 {status === 'connecting' && <p className="text-indigo-300 animate-pulse">Connecting to Interna...</p>}
                 {status === 'error' && <p className="text-rose-400 font-bold">Connection Failed</p>}
                 {systemMessageStatus && <p className="text-amber-400 text-sm font-bold animate-bounce">{systemMessageStatus}</p>}
             </div>
         </div>
      </div>

      {/* 3. Controls (Keep existing) */}
      {/* ... */}
    </div>
  );
};