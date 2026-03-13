"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useInterview } from "./useInterview";
import { useToast } from "./use-toast";
import { generateInterviewFeedback } from "@/ai/flows/generate-interview-feedback";

const WEBSOCKET_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.NEXT_PUBLIC_GEMINI_API_KEY}`;
const AUDIO_SAMPLE_RATE = 16000;

// FIX 1: Added an internal buffer to the AudioWorklet.
// Instead of sending 125 tiny messages per second, it buffers 2048 samples
// and sends ~8 larger messages per second. This prevents WebSocket flooding and lag.
const workletCode = `
  class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.buffer = new Float32Array(2048);
      this.pointer = 0;
    }
    process(inputs, outputs, parameters) {
      const input = inputs[0];
      if (input && input.length > 0) {
        const channelData = input[0];
        for (let i = 0; i < channelData.length; i++) {
          this.buffer[this.pointer++] = channelData[i];
          if (this.pointer >= 2048) {
            this.port.postMessage(new Float32Array(this.buffer));
            this.pointer = 0;
          }
        }
      }
      return true;
    }
  }
  registerProcessor('audio-processor', AudioProcessor);
`;

export const useLiveInterview = () => {
  const {
    jobDescription,
    resume,
    transcript,
    addTranscriptItem,
    updateLastTranscriptItem,
    aiStatus,
    setAiStatus,
    setInterviewStatus,
    setFeedback,
  } = useInterview();
  const { toast } = useToast();

  const [isMuted, setIsMuted] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const isSetupCompleteRef = useRef(false);
  const isConnectingRef = useRef(false); // Prevents duplicate connections

  const isTurnInterruptedRef = useRef(false);
  const lastSpeakerRef = useRef<string | null>(null);
  const isInterviewActiveRef = useRef(false);


  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Helper to strictly stop current audio without triggering 'onended' loops
  const stopCurrentAudio = useCallback(() => {
    if (currentAudioSourceRef.current) {
      currentAudioSourceRef.current.onended = null;
      try {
        currentAudioSourceRef.current.stop();
      } catch (e) {
        // Ignore errors if already stopped
      }
      currentAudioSourceRef.current.disconnect();
      currentAudioSourceRef.current = null;
    }
    isPlayingRef.current = false;
  }, []);

  const playNextInQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) {
      if (!isPlayingRef.current && audioQueueRef.current.length === 0) {
        setAiStatus((prev) => (prev === 'speaking' ? 'listening' : prev));
      }
      return;
    }

    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioQueueRef.current = [];
      return;
    }

    isPlayingRef.current = true;
    setAiStatus('speaking');
    
    const base64Audio = audioQueueRef.current.shift();

    if (base64Audio && audioContextRef.current) {
      try {
        if (audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
        }

        if (!isPlayingRef.current) return; // Abort if interrupted during await

        const audioData = atob(base64Audio);
        const pcm16Data = new Int16Array(audioData.length / 2);
        for (let i = 0; i < pcm16Data.length; i++) {
          const byte1 = audioData.charCodeAt(i * 2);
          const byte2 = audioData.charCodeAt(i * 2 + 1);
          pcm16Data[i] = (byte2 << 8) | byte1;
        }

        const float32Data = new Float32Array(pcm16Data.length);
        for (let i = 0; i < pcm16Data.length; i++) {
          float32Data[i] = pcm16Data[i] / 32767.0;
        }

        const audioBuffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000);
        audioBuffer.getChannelData(0).set(float32Data);

        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
        currentAudioSourceRef.current = source;

        source.onended = () => {
          currentAudioSourceRef.current = null;
          isPlayingRef.current = false;
          playNextInQueue();
        };

        source.start();
      } catch (error) {
        console.error("Error playing audio:", error);
        stopCurrentAudio();
        playNextInQueue();
      }
    } else {
      stopCurrentAudio();
      playNextInQueue();
    }
  }, [setAiStatus, stopCurrentAudio]);

  const startInterview = useCallback(async () => {
    // Prevent ghost connections if user double clicks
    if (isConnectingRef.current || wsRef.current) return;
    isConnectingRef.current = true;
    isInterviewActiveRef.current = true;

    setInterviewStatus("in-progress");
    setAiStatus("thinking");
    isSetupCompleteRef.current = false;
    isTurnInterruptedRef.current = false;
    lastSpeakerRef.current = null;
    let workletUrl = "";
    
    try {
      // FIX 2: Added Echo Cancellation & Noise Suppression
      // This prevents the AI from hearing its own voice through your speakers
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: AUDIO_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      mediaStreamRef.current = stream;

      const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
          recognitionRef.current = new SpeechRecognition();
          recognitionRef.current.continuous = true;
          recognitionRef.current.interimResults = false;
          recognitionRef.current.lang = 'en-US';

          recognitionRef.current.onresult = (event: any) => {
              for (let i = event.resultIndex; i < event.results.length; ++i) {
                  if (event.results[i].isFinal) {
                      const text = event.results[i][0].transcript.trim();
                      if (text) {
                          if (lastSpeakerRef.current !== "Interviewee") {
                              addTranscriptItem({ speaker: "Interviewee", text: text });
                              lastSpeakerRef.current = "Interviewee";
                          } else {
                              updateLastTranscriptItem(" " + text);
                          }
                      }
                  }
              }
          };

          recognitionRef.current.onend = () => {
              if (isInterviewActiveRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
                  try { recognitionRef.current.start(); } catch(e) {}
              }
          };
          recognitionRef.current.start();
      }

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: AUDIO_SAMPLE_RATE,
      });
      audioContextRef.current = audioContext;

      const blob = new Blob([workletCode], { type: 'application/javascript' });
      workletUrl = URL.createObjectURL(blob);

      await audioContext.audioWorklet.addModule(workletUrl);

      const workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(workletNode);

      const ws = new WebSocket(WEBSOCKET_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        const setupMessage = {
          setup: {
            model: "models/gemini-2.5-flash-native-audio-latest",
            systemInstruction: {
              parts: [
                {
                  text: `You are an expert technical interviewer named Echo. Conduct a realistic mock interview for an IT role based on the provided Job Description and Candidate Resume. Your goal is to assess the candidate's skills and experience. Ask one question at a time. Wait for the candidate's response. Ask follow-up questions based on their answers. Be conversational, professional, and act like a real human. Start the interview by introducing yourself and asking the first question. If the candidate interrupts you, stop your current thought and address their interruption naturally.\n\n## Job Description:\n${jobDescription}\n\n## Candidate Resume:\n${resume}`,
                },
              ],
            },
            generationConfig: {
              responseModalities: ["AUDIO", "TEXT"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
              },
            },
          },
        };
        ws.send(JSON.stringify(setupMessage));
      };

      workletNode.port.onmessage = (event) => {
        if (!isSetupCompleteRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || isMutedRef.current) {
          return;
        }

        const float32Audio = event.data as Float32Array;
        const pcm16Data = new Int16Array(float32Audio.length);
        for (let i = 0; i < float32Audio.length; i++) {
          const s = Math.max(-1, Math.min(1, float32Audio[i]));
          pcm16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Fast Base64 encoding for the buffered chunk
        let binary = "";
        const bytes = new Uint8Array(pcm16Data.buffer);
        const chunkSize = 0x8000; 
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
        }
        const base64AudioData = btoa(binary);

        const clientContentMessage = {
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: `audio/pcm;rate=${AUDIO_SAMPLE_RATE}`,
                data: base64AudioData,
              },
            ],
          },
        };
        wsRef.current.send(JSON.stringify(clientContentMessage));
      };

      ws.onmessage = async (event) => {
        try {
          let messageData = event.data;
          if (messageData instanceof Blob) {
            messageData = await messageData.text();
          }

          const response = JSON.parse(messageData);
          
          if (response.setupComplete) {
            isSetupCompleteRef.current = true;
            const kickoffMessage = {
              clientContent: {
                turns: [
                  {
                    role: "user",
                    parts: [{ text: "Hello! I am ready for the interview. Please introduce yourself and ask the first question." }]
                  }
                ],
                turnComplete: true
              }
            };
            ws.send(JSON.stringify(kickoffMessage));
            return;
          }

          // FIX 3: Robust Interruption Handling
          if (response.serverContent?.interrupted) {
             isTurnInterruptedRef.current = true;
             audioQueueRef.current = [];
             stopCurrentAudio();
             setAiStatus("listening");
             return; // Drop the rest of this message
          }

          if (response.serverContent?.turnComplete) {
            isTurnInterruptedRef.current = false;
            setAiStatus("listening");
            lastSpeakerRef.current = null;
          }

          const parts = response.serverContent?.modelTurn?.parts;
          if (parts) {
              if (lastSpeakerRef.current !== 'AI Interviewer') {
                  isTurnInterruptedRef.current = false; // Reset on new AI turn
              }

              for (const part of parts) {
                  if (part.text) {
                      if (lastSpeakerRef.current !== "AI Interviewer") {
                          addTranscriptItem({ speaker: "AI Interviewer", text: part.text });
                          lastSpeakerRef.current = "AI Interviewer";
                      } else {
                          updateLastTranscriptItem(part.text);
                      }
                  }
                  
                  if (part.inlineData?.data) {
                      if (!isTurnInterruptedRef.current) {
                          audioQueueRef.current.push(part.inlineData.data);
                          playNextInQueue();
                      }
                  }
              }
          }
        } catch (e) {
          console.error("Error parsing WebSocket message:", e);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket Error:", error);
        toast({ title: "Connection Error", description: "Could not connect to the interview service.", variant: "destructive" });
        setAiStatus("idle");
      };

      ws.onclose = () => {
        isConnectingRef.current = false;
        if (workletUrl) URL.revokeObjectURL(workletUrl);
      };
    } catch (error) {
      isConnectingRef.current = false;
      console.error("Error starting interview:", error);
      toast({ title: "Microphone Error", description: "Could not access the microphone. Please check permissions.", variant: "destructive" });
      setAiStatus("idle");
      setInterviewStatus("idle");
    }
  }, [setInterviewStatus, setAiStatus, toast, jobDescription, resume, addTranscriptItem, updateLastTranscriptItem, playNextInQueue, stopCurrentAudio]);

  const endInterview = useCallback(async () => {
    isInterviewActiveRef.current = false;
    setAiStatus("thinking");
    
    // Hard cleanup of all audio and connections
    audioQueueRef.current = [];
    stopCurrentAudio();

    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    isConnectingRef.current = false;
    setInterviewStatus("finished");
    
    toast({ title: "Interview Ended", description: "Generating your feedback report..." });
    
    try {
      const feedbackResult = await generateInterviewFeedback({ jobDescription, resume, transcript });
      setFeedback(feedbackResult);
    } catch (error) {
      console.error("Error generating feedback:", error);
      toast({ title: "Feedback Error", description: "Could not generate feedback report.", variant: "destructive" });
    }
  }, [jobDescription, resume, transcript, setAiStatus, setInterviewStatus, setFeedback, toast, stopCurrentAudio]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isInterviewActiveRef.current = false;
      audioQueueRef.current = [];
      stopCurrentAudio();
      if (wsRef.current) wsRef.current.close();
      if (audioContextRef.current?.state !== 'closed') audioContextRef.current?.close();
      if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      }
    };
  }, [stopCurrentAudio]);

  return { startInterview, endInterview, isMuted, toggleMute, transcriptContainerRef };
};
