import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, FunctionDeclaration, Type } from '@google/genai';
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
  const [systemMessageStatus, setSystemMessageStatus] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(600);

  // Refs
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
  
  const mouthRef = useRef<SVGEllipseElement>(null);
  const lastUserSpeechTimeRef = useRef<number>(Date.now());
  const fullTranscriptHistory = useRef<string[]>([]);
  const isWaitingForResponseRef = useRef<boolean>(false);

  // --- CLEANUP ---
  const disconnect = () => {
    isConnectedRef.current = false;
    if (scriptProcessorRef.current) {
        scriptProcessorRef.current.onaudioprocess = null;
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current = null;
    }
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch (e) {}
      sessionRef.current = null;
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
      setSystemMessageStatus(`Ending: ${reason}`);
      setTimeout(() => {
          disconnect();
          onComplete(fullTranscriptHistory.current.join('\n'), reason);
      }, 2000);
  };

  // --- VISUALIZER LOGIC ---
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

          if (canvas.width !== canvas.parentElement?.offsetWidth) {
             canvas.width = canvas.parentElement?.offsetWidth || 300;
             canvas.height = canvas.parentElement?.offsetHeight || 300;
          }

          const width = canvas.width;
          const height = canvas.height;
          const centerX = width / 2;
          const centerY = height / 2;

          ctx.clearRect(0, 0, width, height);

          let sum = 0;
          for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
          const avg = sum / bufferLength;
          const volume = Math.min(avg / 50, 1);

          // Mouth Animation
          if (mouthRef.current) {
              const baseRy = 2;
              const maxRy = 8;
              const currentRy = baseRy + (volume * (maxRy - baseRy));
              mouthRef.current.setAttribute('ry', currentRy.toFixed(2));
          }

          // Orb Animation
          const baseColor = isAiSpeakingRef.current ? '99, 102, 241' : isUserSpeaking ? '16, 185, 129' : '139, 92, 246';
          const radius = 60 + (volume * 30);

          const gradient = ctx.createRadialGradient(centerX, centerY, 60, centerX, centerY, radius + 50);
          gradient.addColorStop(0, `rgba(${baseColor}, 0.8)`);
          gradient.addColorStop(1, `rgba(${baseColor}, 0)`);

          ctx.beginPath();
          ctx.arc(centerX, centerY, radius + 50, 0, 2 * Math.PI);
          ctx.fillStyle = gradient;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(centerX, centerY, 60 + (volume * 10), 0, 2 * Math.PI);
          ctx.fillStyle = `rgb(${baseColor})`;
          ctx.fill();
      };
      draw();
  };

  // --- INITIALIZATION ---
  useEffect(() => {
    isMountedRef.current = true;

    const initSession = async () => {
      try {
        const apiKey = process.env.API_KEY;
        if (!apiKey) { setStatus('error'); return; }

        const ai = new GoogleGenAI({ apiKey });
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        
        // 1. Output Audio Context
        const audioContext = new AudioContextClass(); 
        audioContextRef.current = audioContext;
        // Ensure AudioContext is not suspended (important for first playback)
        if (audioContext.state === 'suspended') await audioContext.resume();

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        drawVisualizer();
        // FIX 3.1: Connect analyser permanently to the destination
        analyser.connect(audioContext.destination);

        // 2. Input Audio Setup
        const inputAudioContext = new AudioContextClass();
        inputAudioContextRef.current = inputAudioContext;
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

        // 3. Connect Gemini
        const sessionPromise = ai.live.connect({
          model: 'gemini-2.5-flash-native-audio-preview-09-2025',
          callbacks: {
            onopen: async () => {
              if (!isMountedRef.current) return;
              setStatus('connected');
              isConnectedRef.current = true;
              
              // *** TRIGGER AI SPEECH IMMEDIATELY ***
              const session = await sessionPromise;
              // FIX 4: Robust trigger message with a slight delay to ensure the session is ready.
              setTimeout(() => {
                  if (sessionRef.current) {
                      // Attempt to resume the audio context again just before sending the first prompt
                      if (audioContextRef.current?.state === 'suspended') {
                          audioContextRef.current.resume();
                      }
                      sessionRef.current.sendRealtimeInput([{ text: "Start the interview now." }]);
                  }
              }, 100);

              scriptProcessor.onaudioprocess = (e) => {
                 if (!isConnectedRef.current) return;
                 const inputData = e.inputBuffer.getChannelData(0);
                 
                 // VAD
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
                     session.sendRealtimeInput([{ mimeType: "audio/pcm;rate=16000", data: createBlob(downsampled, 16000).data }]);
                 }
              };
            },
            onmessage: async (message: LiveServerMessage) => {
                if (!isMountedRef.current) return;

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
                    isWaitingForResponseRef.current = true;
                }

                if (message.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
                    const audioData = message.serverContent.modelTurn.parts[0].inlineData.data;
                    const buffer = await decodeAudioData(decode(audioData), audioContext, 24000, 1);
                    
                    const src = audioContext.createBufferSource();
                    src.buffer = buffer;
                    src.connect(analyser); 
                    // FIX 3.2: Removed redundant connection to audioContext.destination
                    
                    const currentTime = audioContext.currentTime;
                    const startTime = Math.max(currentTime, nextAudioStartTimeRef.current);
                    src.start(startTime);
                    nextAudioStartTimeRef.current = startTime + buffer.duration;
                    
                    isAiSpeakingRef.current = true;
                    // FIX 5: Simplified onended handler to just reset the speaking flag.
                    src.onended = () => {
                         isAiSpeakingRef.current = false;
                    };
                }
            },
            onerror: () => setStatus('error'),
          },
          config: {
            responseModality: "AUDIO", 
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
            tools: [{ functionDeclarations: [endInterviewTool] }],
            systemInstruction: {
              parts: [{
                text: `You are Interna, an AI Interviewer developed by Internadda. 
                       Candidate Name: ${candidate.name}
                       Role: ${candidate.field}
                       Context: ${candidate.jobDescription.substring(0, 1000)}
                       
                       **INTERVIEW PROTOCOL:**
                       1. **IMMEDIATE INTRO:** As soon as you connect, say: "Hello ${candidate.name}, I am Interna, your AI interviewer from Internadda. Welcome to your assessment for the ${candidate.field} role. Let's begin."
                       2. **BEHAVIORAL START:** Ask ONE quick behavioral question (e.g., "Tell me about yourself" or "Why this role?").
                       3. **TECHNICAL LOOP (5 Questions):** - Ask 5 technical questions relevant to the role/context.
                          - Ask one by one. Wait for the answer.
                          - Acknowledge the answer briefly (e.g., "Good point", "Understood") before moving to the next.
                       4. **CONCLUSION:** After the 5th technical question, say: "Thank you, this concludes our interview." and IMMEDIATELY call the 'endInterview' tool.
                       `
              }]
            }
          }
        });
        sessionRef.current = await sessionPromise;
      } catch (e) { setStatus('error'); }
    };

    initSession();

    const timerInterval = setInterval(() => {
        setTimeLeft(prev => {
            if (prev <= 1) { handleTermination("Time Limit"); return 0; }
            return prev - 1;
        });
    }, 1000);

    return () => { 
        isMountedRef.current = false; 
        clearInterval(timerInterval);
        disconnect(); 
    };
  }, []);

  const toggleMute = () => {
    if (streamRef.current) {
        const tracks = streamRef.current.getAudioTracks();
        tracks.forEach(t => t.enabled = !isMuted);
        setIsMuted(!isMuted);
    }
  };

  return (
    <div className="grid grid-rows-[auto_1fr_auto] h-full w-full bg-slate-950 text-white relative overflow-hidden">
      
      {/* 1. Header */}
      <div className="z-20 flex items-center justify-between px-6 py-4 bg-slate-900/50 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-4">
           <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${
               status === 'connected' ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/20 border-rose-500/30 text-rose-400'
           }`}>
               <span className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-current'}`}></span>
               <span className="text-xs font-bold uppercase tracking-widest">{status}</span>
           </div>
           <div className="flex items-center gap-2 px-3 py-1 rounded-full font-mono font-medium bg-slate-800 text-slate-300">
              <span>{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</span>
           </div>
        </div>
        <button onClick={() => handleTermination("User ended session")} className="text-xs text-rose-400 border border-rose-500/30 px-3 py-1 rounded-full hover:bg-rose-500/10">End</button>
      </div>

      {/* 2. Main Stage */}
      <div className="relative flex items-center justify-center overflow-hidden w-full h-full">
         <video ref={videoRef} autoPlay muted playsInline className="absolute opacity-0 pointer-events-none w-1 h-1" />
         <canvas ref={canvasRef} className="absolute inset-0 w-full h-full z-0 opacity-60" />
         
         {/* ROBOT UI */}
         <div className="relative z-10 flex flex-col items-center justify-center transition-transform duration-300">
             <svg width="220" height="220" viewBox="0 0 200 200" fill="none" className={`transition-all duration-500 ${status === 'connected' ? 'drop-shadow-[0_0_30px_rgba(139,92,246,0.3)]' : 'opacity-50 grayscale'}`}>
                <rect x="20" y="20" width="160" height="160" rx="30" fill="#F1F5F9" />
                <path d="M85 20H115V15C115 12.2 112.7 10 110 10H90C87.2 10 85 12.2 85 15V20Z" fill="#CBD5E1"/>
                <circle cx="65" cy="80" r="12" fill="#0F172A" />
                <circle cx="135" cy="80" r="12" fill="#0F172A" />
                {status === 'connected' && (
                    <>
                      <circle cx="65" cy="80" r="4" fill="#38BDF8" className="animate-pulse" />
                      <circle cx="135" cy="80" r="4" fill="#38BDF8" className="animate-pulse" />
                    </>
                )}
                <ellipse ref={mouthRef} cx="100" cy="135" rx="20" ry="2" fill="#0F172A" />
             </svg>
             
             <div className="mt-8 text-center min-h-[24px]">
                 {status === 'connecting' && <p className="text-indigo-300 animate-pulse font-medium">Connecting to Interna...</p>}
                 {status === 'error' && <p className="text-rose-400 font-bold">Connection Failed</p>}
                 {status === 'connected' && !isAiSpeakingRef.current && <p className="text-slate-400 text-sm">Listening...</p>}
             </div>
         </div>
      </div>

      {/* 3. Controls */}
      <div className="z-20 p-6 flex flex-col items-center gap-4 bg-slate-900/80 backdrop-blur-md border-t border-white/10">
         {showTranscript && (
             <div className="absolute bottom-24 left-6 right-6 max-h-[30vh] bg-black/90 rounded-2xl border border-white/10 p-4 overflow-y-auto">
                 {transcriptLines.map((line, i) => (
                     <p key={i} className={`mb-2 text-sm ${line.speaker === 'ai' ? 'text-indigo-300' : 'text-emerald-300'}`}>
                         <strong className="uppercase text-xs opacity-50 mr-2">{line.speaker}:</strong>{line.text}
                     </p>
                 ))}
             </div>
         )}

         <div className="flex items-center gap-6">
            <button onClick={toggleMute} className={`p-4 rounded-full transition-all ${isMuted ? 'bg-rose-500/20 text-rose-500' : 'bg-slate-800 text-white hover:bg-slate-700'}`}>
                {isMuted ? "Unmute" : "Mute"}
            </button>
            <button onClick={() => setShowTranscript(!showTranscript)} className={`p-4 rounded-full transition-all ${showTranscript ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                Transcript
            </button>
         </div>
      </div>
    </div>
  );
};
