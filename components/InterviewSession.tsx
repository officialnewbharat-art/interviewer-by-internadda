import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, FunctionDeclaration, Type } from '@google/genai';
import { CandidateInfo } from '../types';
import { createBlob, downsampleBuffer, decodeAudioData, decode } from '../utils/audio';

interface InterviewSessionProps {
  candidate: CandidateInfo;
  onComplete: (transcript: string, terminationReason?: string) => void;
}

// Tool definition to let AI end the interview
const endInterviewTool: FunctionDeclaration = {
  name: "endInterview",
  description: "Ends the interview session. Call this when 5 questions are completed or the user requests to end.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      reason: { 
        type: Type.STRING,
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
  const [timeLeft, setTimeLeft] = useState(600); // 10 Minutes

  // Refs for Audio & Connection
  const isMountedRef = useRef<boolean>(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
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
  const lastUserSpeechTimeRef = useRef<number>(Date.now());
  const fullTranscriptHistory = useRef<string[]>([]);
  const isWaitingForResponseRef = useRef<boolean>(false);
  
  // Proctoring Refs
  const tabSwitchCountRef = useRef<number>(0);
  const silenceWarningCountRef = useRef<number>(0);

  // --- 1. CLEANUP & TERMINATION ---
  const disconnect = () => {
    isConnectedRef.current = false;
    
    if (scriptProcessorRef.current) {
        scriptProcessorRef.current.onaudioprocess = null;
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current = null;
    }
    
    if (sessionRef.current) {
      try {
          sessionRef.current.close();
      } catch (e) { console.error(e); }
      sessionRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
       audioContextRef.current.close();
    }
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
       inputAudioContextRef.current.close();
    }

    if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
    }

    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch(e) {}
    });
    sourcesRef.current.clear();
  };

  const handleTermination = (reason: string) => {
      if (terminationTriggeredRef.current) return;
      terminationTriggeredRef.current = true;
      
      setSystemMessageStatus(`Ending: ${reason}`);
      
      // Give UI a moment to show the message before unmounting
      setTimeout(() => {
          disconnect();
          onComplete(fullTranscriptHistory.current.join('\n'), reason);
      }, 2000);
  };

  // --- 2. VISUALIZER (The "Orb") ---
  const drawVisualizer = () => {
      const canvas = canvasRef.current;
      const analyser = analyserRef.current;
      if (!canvas || !analyser) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const draw = () => {
          if (!isMountedRef.current) return;
          animationRef.current = requestAnimationFrame(draw);
          analyser.getByteFrequencyData(dataArray);

          // Auto-resize
          if (canvas.width !== canvas.parentElement?.offsetWidth || canvas.height !== canvas.parentElement?.offsetHeight) {
             canvas.width = canvas.parentElement?.offsetWidth || 300;
             canvas.height = canvas.parentElement?.offsetHeight || 300;
          }

          const width = canvas.width;
          const height = canvas.height;
          const centerX = width / 2;
          const centerY = height / 2;

          ctx.clearRect(0, 0, width, height);

          // Calculate average volume
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
          const average = sum / bufferLength;
          const normalizedVol = Math.min(average / 100, 1); // 0 to 1

          // Dynamic colors based on state
          let baseColor = '100, 116, 139'; // Slate (Connecting)
          if (status === 'connected') {
             if (isAiSpeakingRef.current) baseColor = '99, 102, 241'; // Indigo (AI Speaking)
             else if (isUserSpeaking) baseColor = '16, 185, 129'; // Emerald (User Speaking)
             else baseColor = '139, 92, 246'; // Purple (Idle)
          } else if (status === 'error') {
             baseColor = '244, 63, 94'; // Rose (Error)
          }

          // Draw "Breathing" Orb
          const baseRadius = 60;
          const pulse = normalizedVol * 40; 
          
          // Outer Glow
          const gradient = ctx.createRadialGradient(centerX, centerY, baseRadius, centerX, centerY, baseRadius + 100 + pulse);
          gradient.addColorStop(0, `rgba(${baseColor}, 0.8)`);
          gradient.addColorStop(0.5, `rgba(${baseColor}, 0.2)`);
          gradient.addColorStop(1, `rgba(${baseColor}, 0)`);
          
          ctx.beginPath();
          ctx.arc(centerX, centerY, baseRadius + 100 + pulse, 0, 2 * Math.PI);
          ctx.fillStyle = gradient;
          ctx.fill();

          // Core Circle
          ctx.beginPath();
          ctx.arc(centerX, centerY, baseRadius + (pulse * 0.5), 0, 2 * Math.PI);
          ctx.fillStyle = `rgb(${baseColor})`;
          ctx.fill();

          // Ripples
          ctx.strokeStyle = `rgba(255, 255, 255, 0.3)`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(centerX, centerY, baseRadius + (pulse * 0.8) + 10, 0, 2 * Math.PI);
          ctx.stroke();
      };
      draw();
  };


  // --- 3. INIT & CONNECTION ---
  useEffect(() => {
    isMountedRef.current = true;

    const initSession = async () => {
      try {
        const apiKey = process.env.API_KEY;
        if (!apiKey) {
            console.error("API Key missing");
            setStatus('error');
            return;
        }

        const ai = new GoogleGenAI({ apiKey });
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        
        // Output Audio Context
        const audioContext = new AudioContextClass({ sampleRate: 24000 }); 
        audioContextRef.current = audioContext;
        
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        
        // Start Visualizer
        drawVisualizer();

        // Input Audio Context
        const inputAudioContext = new AudioContextClass();
        inputAudioContextRef.current = inputAudioContext;
        
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: true });
        streamRef.current = stream;
        
        // Connect hidden video for proctoring/preview
        if (videoRef.current) {
            videoRef.current.srcObject = stream;
        }
        
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
              console.log("Gemini Live Connected");
              
              scriptProcessor.onaudioprocess = (e) => {
                 if (!isConnectedRef.current) return;
                 
                 const inputData = e.inputBuffer.getChannelData(0);
                 
                 // Simple VAD (Voice Activity Detection)
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

                 // Send Audio to Gemini
                 const downsampled = downsampleBuffer(inputData, inputAudioContext.sampleRate, 16000);
                 if (downsampled.length > 0) {
                     sessionPromise.then(s => s.sendRealtimeInput({ media: createBlob(downsampled, 16000) }));
                 }
              };
            },
            onmessage: async (message: LiveServerMessage) => {
                if (!isMountedRef.current) return;

                // Handle Tool Calls (End Interview)
                if (message.toolCall) {
                   const call = message.toolCall.functionCalls?.find(f => f.name === 'endInterview');
                   if (call) {
                       const reason = (call.args as any)?.reason || "Completed";
                       handleTermination(reason);
                   }
                }

                // Handle Text Transcript
                if (message.serverContent?.modelTurn?.parts?.[0]?.text) {
                    const text = message.serverContent.modelTurn.parts[0].text;
                    setTranscriptLines(prev => [...prev, {speaker: 'ai', text}]);
                    fullTranscriptHistory.current.push(`AI: ${text}`);
                    isAiSpeakingRef.current = true;
                }

                // Handle Turn Completion
                if (message.serverContent?.turnComplete) {
                    isAiSpeakingRef.current = false;
                    isWaitingForResponseRef.current = true;
                }

                // Handle Audio Output
                if (message.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
                    const audioData = message.serverContent.modelTurn.parts[0].inlineData.data;
                    const buffer = await decodeAudioData(decode(audioData), audioContext, 24000, 1);
                    
                    const src = audioContext.createBufferSource();
                    src.buffer = buffer;
                    src.connect(analyser); // Connect to visualizer
                    analyser.connect(audioContext.destination); // Connect to speakers
                    
                    src.start(nextAudioStartTimeRef.current);
                    nextAudioStartTimeRef.current += buffer.duration;
                    
                    // Sync "speaking" state with audio duration
                    isAiSpeakingRef.current = true;
                    src.onended = () => {
                         if(audioContext.currentTime >= nextAudioStartTimeRef.current) {
                             isAiSpeakingRef.current = false;
                         }
                    };
                }
            },
            onerror: (err) => {
                console.error("Gemini Error:", err);
                setStatus('error');
            },
            onclose: () => {
                setStatus('error');
            }
          },
          config: {
            responseModalities: [ "AUDIO" as any ], 
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
      } catch (e) {
        console.error(e);
        setStatus('error');
      }
    };

    initSession();

    // --- PROCTORING: TIMER & TAB SWITCHING ---
    const timerInterval = setInterval(() => {
        setTimeLeft(prev => {
            if (prev <= 1) {
                handleTermination("Time Limit Exceeded");
                return 0;
            }
            return prev - 1;
        });
    }, 1000);

    const handleVisibilityChange = () => {
        if (document.hidden) {
            tabSwitchCountRef.current += 1;
            setSystemMessageStatus(`Warning: Tab switch detected (${tabSwitchCountRef.current}/3)`);
            if (tabSwitchCountRef.current >= 3) {
                handleTermination("Disqualified: Excessive Tab Switching");
            }
        }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => { 
        isMountedRef.current = false; 
        clearInterval(timerInterval);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        disconnect(); 
    };
  }, []);

  return (
    <div className="grid grid-rows-[auto_1fr_auto] h-full w-full bg-slate-950 text-white relative overflow-hidden">
      
      {/* 1. Header */}
      <div className="z-20 flex items-center justify-between px-6 py-4 bg-slate-900/50 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-4">
           {/* Status Badge */}
           <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${
               status === 'connected' ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' :
               status === 'error' ? 'bg-rose-500/20 border-rose-500/30 text-rose-400' :
               'bg-slate-500/20 border-slate-500/30 text-slate-400'
           }`}>
               <span className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-current'}`}></span>
               <span className="text-xs font-bold uppercase tracking-widest">{status}</span>
           </div>
           
           {/* Timer */}
           <div className={`flex items-center gap-2 px-3 py-1 rounded-full font-mono font-medium ${
               timeLeft < 60 ? 'bg-rose-500/20 text-rose-400 animate-pulse' : 'bg-slate-800 text-slate-300'
           }`}>
              <span>{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</span>
           </div>
        </div>

        <button onClick={() => handleTermination("User ended session")} className="text-xs text-rose-400 hover:text-rose-300 font-bold uppercase tracking-widest border border-rose-500/30 px-3 py-1 rounded-full hover:bg-rose-500/10 transition-colors">
            End Interview
        </button>
      </div>

      {/* 2. Main Stage (Visualizer) */}
      <div className="relative flex items-center justify-center overflow-hidden w-full h-full">
         
         {/* Hidden Video for Proctoring/Stream */}
         <video ref={videoRef} autoPlay muted playsInline className="absolute opacity-0 pointer-events-none w-1 h-1" />

         {/* The Canvas (Orb) */}
         <canvas 
            ref={canvasRef} 
            className="w-full h-full absolute inset-0 z-10"
         />
         
         {/* Status Text Overlay */}
         <div className="relative z-20 flex flex-col items-center justify-center pointer-events-none mt-40">
             <div className="text-center">
                 {status === 'connecting' && <p className="text-indigo-300 animate-pulse font-medium">Connecting to Interna...</p>}
                 {status === 'error' && <p className="text-rose-400 font-bold">Connection Failed</p>}
                 {systemMessageStatus && <p className="text-amber-400 text-sm font-bold animate-bounce bg-black/50 px-3 py-1 rounded-full">{systemMessageStatus}</p>}
             </div>
         </div>
      </div>

      {/* 3. Controls / Transcript Toggle */}
      <div className="z-20 p-6 flex flex-col items-center gap-4">
         
         {/* Transcript Popover */}
         {showTranscript && (
             <div className="absolute bottom-24 left-6 right-6 max-h-[30vh] bg-black/80 backdrop-blur-xl rounded-2xl border border-white/10 p-4 overflow-y-auto">
                 {transcriptLines.map((line, i) => (
                     <p key={i} className={`mb-2 text-sm ${line.speaker === 'ai' ? 'text-indigo-300' : 'text-emerald-300'}`}>
                         <strong className="uppercase text-xs opacity-50 mr-2">{line.speaker}:</strong>
                         {line.text}
                     </p>
                 ))}
                 <div className="h-4" /> {/* Spacer */}
             </div>
         )}

         <div className="flex items-center gap-4">
            <button 
                onClick={() => setShowTranscript(!showTranscript)}
                className={`p-3 rounded-full transition-all ${showTranscript ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                </svg>
            </button>
            
            <div className={`px-6 py-2 rounded-full font-bold text-sm tracking-wide transition-colors ${
                isUserSpeaking ? 'bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.5)]' : 'bg-slate-800 text-slate-500'
            }`}>
                {isUserSpeaking ? 'LISTENING...' : 'INTERNA SPEAKING'}
            </div>
         </div>
      </div>
    </div>
  );
};
