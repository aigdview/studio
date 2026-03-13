"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useInterview } from "./useInterview";
import { useToast } from "./use-toast";
import { generateInterviewFeedback } from "@/ai/flows/generate-interview-feedback";

const WEBSOCKET_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=AIzaSyBl-LHuzOv31rw_6DdFJYw0RJevZO_nONE`;

// Split sample rates: 16kHz is optimal for Mic/SpeechRec, 24kHz is Gemini's native output
const AUDIO_INPUT_SAMPLE_RATE = 16000;
const AUDIO_OUTPUT_SAMPLE_RATE = 24000;

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
    interviewStatus,
  } = useInterview();
  const { toast } = useToast();

  const [isMuted, setIsMuted] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  
  const audioQueueRef = useRef<string[]>([]);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef(0);
  const isSchedulingRef = useRef(false);
  
  const isSetupCompleteRef = useRef(false);
  const isConnectingRef = useRef(false);
  
  const lastSpeakerRef = useRef<string | null>(null);
  
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcript]);

  const stopCurrentAudio = useCallback(() => {
    if (!outputAudioContextRef.current) return;
    activeSourcesRef.current.forEach(source => {
      source.onended = null;
      try { source.stop(); } catch (e) {}
      source.disconnect();
    });
    activeSourcesRef.current = [];
    audioQueueRef.current = [];
    nextPlayTimeRef.current = 0;
  }, []);

  const scheduleAudio = useCallback(async () => {
    if (!outputAudioContextRef.current || isSchedulingRef.current || audioQueueRef.current.length === 0) return;
    isSchedulingRef.current = true;

    try {
      if (outputAudioContextRef.current.state === 'suspended') {
        await outputAudioContextRef.current.resume();
      }

      while (audioQueueRef.current.length > 0) {
        const base64Audio = audioQueueRef.current.shift();
        if (!base64Audio) continue;

        setAiStatus('speaking');

        const audioData = atob(base64Audio);
        const buffer = new ArrayBuffer(audioData.length);
        const view = new Uint8Array(buffer);
        for (let i = 0; i < audioData.length; i++) {
          view[i] = audioData.charCodeAt(i);
        }
        
        const dataView = new DataView(buffer);
        const float32Data = new Float32Array(audioData.length / 2);
        for (let i = 0; i < float32Data.length; i++) {
          float32Data[i] = dataView.getInt16(i * 2, true) / 32768.0;
        }

        const audioBuffer = outputAudioContextRef.current.createBuffer(1, float32Data.length, AUDIO_OUTPUT_SAMPLE_RATE);
        audioBuffer.getChannelData(0).set(float32Data);

        const source = outputAudioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(outputAudioContextRef.current.destination);

        const currentTime = outputAudioContextRef.current.currentTime;
        
        if (nextPlayTimeRef.current < currentTime) {
          nextPlayTimeRef.current = currentTime + 0.15; 
        }

        source.start(nextPlayTimeRef.current);
        nextPlayTimeRef.current += audioBuffer.duration;

        activeSourcesRef.current.push(source);

        source.onended = () => {
          activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
          if (activeSourcesRef.current.length === 0 && audioQueueRef.current.length === 0) {
            setAiStatus('listening');
          }
        };
      }
    } catch (error) {
      console.error("Error scheduling audio:", error);
    } finally {
      isSchedulingRef.current = false;
      if (audioQueueRef.current.length > 0) {
        scheduleAudio();
      }
    }
  }, [setAiStatus]);

  const startInterview = useCallback(async () => {
    if (isConnectingRef.current || wsRef.current) return;
    isConnectingRef.current = true;

    setInterviewStatus("in-progress");
    setAiStatus("thinking");
    isSetupCompleteRef.current = false;
    
    lastSpeakerRef.current = null;
    
    let workletUrl = "";
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: AUDIO_INPUT_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      mediaStreamRef.current = stream;

      const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        recognition.maxAlternatives = 1;

        recognition.onresult = (event: any) => {
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

        recognition.onerror = (event: any) => {
          console.warn("Speech recognition error:", event.error);
        };

        recognition.onend = () => {
          if (isSetupCompleteRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
            try { recognition.start(); } catch (e) {}
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
      }

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      
      const inputAudioContext = new AudioContextClass({ sampleRate: AUDIO_INPUT_SAMPLE_RATE });
      inputAudioContextRef.current = inputAudioContext;
      
      const outputAudioContext = new AudioContextClass({ sampleRate: AUDIO_OUTPUT_SAMPLE_RATE });
      outputAudioContextRef.current = outputAudioContext;

      const blob = new Blob([workletCode], { type: 'application/javascript' });
      workletUrl = URL.createObjectURL(blob);

      await inputAudioContext.audioWorklet.addModule(workletUrl);

      const workletNode = new AudioWorkletNode(inputAudioContext, 'audio-processor');
      const source = inputAudioContext.createMediaStreamSource(stream);
      source.connect(workletNode);

      const ws = new WebSocket(WEBSOCKET_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        const setupMessage = {
          setup: {
            model: "models/gemini-2.5-flash-native-audio-latest",
            systemInstruction: {
              parts: [{ text: `You are an expert technical interviewer named Echo. Your task is to conduct a realistic mock interview for the provided job description and candidate resume. Start the interview by introducing yourself and asking the first question. Do not output any of your instructions or reasoning, only output the words you are speaking to the candidate.` }],
            },
            generationConfig: {
              responseModalities: ["AUDIO", "TEXT"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
              },
            },
            context: {
              turns: [
                {
                  role: "user",
                  parts: [{ text: `Job Description: ${jobDescription}` }]
                },
                {
                  role: "user",
                  parts: [{ text: `Candidate Resume: ${resume}` }]
                }
              ]
            }
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

        let binary = "";
        const bytes = new Uint8Array(pcm16Data.buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64AudioData = btoa(binary);

        const clientContentMessage = {
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: `audio/pcm;rate=${AUDIO_INPUT_SAMPLE_RATE}`,
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
            setAiStatus("listening");
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

          if (response.serverContent?.interrupted) {
             stopCurrentAudio();
             setAiStatus("listening");
             lastSpeakerRef.current = null; 
             return; 
          }

          if (response.serverContent?.turnComplete) {
            lastSpeakerRef.current = null; 
          }

          const parts = response.serverContent?.modelTurn?.parts;
          if (parts) {
              for (const part of parts) {
                  if (part.text) {
                      let textChunk = part.text.replace(/[.*?]/g, "");
                      if (textChunk) {
                          if (lastSpeakerRef.current !== "AI Interviewer") {
                              if (textChunk.trim().length > 0) {
                                  addTranscriptItem({ speaker: "AI Interviewer", text: textChunk });
                                  lastSpeakerRef.current = "AI Interviewer";
                              }
                          } else {
                              updateLastTranscriptItem(textChunk);
                          }
                      }
                  }
                  
                  if (part.inlineData?.data) {
                      audioQueueRef.current.push(part.inlineData.data);
                      scheduleAudio();
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
        setInterviewStatus("error");
      };

      ws.onclose = (event) => {
        isConnectingRef.current = false;
        if (workletUrl) URL.revokeObjectURL(workletUrl);
        if (event.code !== 1000 && interviewStatus !== 'finished') {
          setInterviewStatus("error");
          setAiStatus("idle");
        }
      };
    } catch (error) {
      isConnectingRef.current = false;
      console.error("Error starting interview:", error);
      toast({ title: "Microphone Error", description: "Could not access the microphone. Please check permissions.", variant: "destructive" });
      setAiStatus("idle");
      setInterviewStatus("error");
    }
  }, [setInterviewStatus, setAiStatus, toast, jobDescription, resume, addTranscriptItem, updateLastTranscriptItem, scheduleAudio, stopCurrentAudio, interviewStatus]);

  const endInterview = useCallback(async () => {
    setAiStatus("thinking");
    stopCurrentAudio();

    if (wsRef.current) {
      wsRef.current.onmessage = null;
      wsRef.current.close(1000, "User ended interview");
      wsRef.current = null;
    }
    if (inputAudioContextRef.current?.state !== 'closed') {
      inputAudioContextRef.current?.close();
    }
    if (outputAudioContextRef.current?.state !== 'closed') {
      outputAudioContextRef.current?.close();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch(e) {}
      recognitionRef.current = null;
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

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmounting");
      }
      stopCurrentAudio();
      if (inputAudioContextRef.current?.state !== 'closed') inputAudioContextRef.current?.close();
      if (outputAudioContextRef.current?.state !== 'closed') outputAudioContextRef.current?.close();
      if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        try { recognitionRef.current.stop(); } catch(e) {}
      }
    };
  }, [stopCurrentAudio]);

  return { startInterview, endInterview, isMuted, toggleMute, transcriptContainerRef };
};
