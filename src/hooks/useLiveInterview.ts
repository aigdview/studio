"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useInterview } from "./useInterview";
import { useToast } from "./use-toast";
import { generateInterviewFeedback } from "@/ai/flows/generate-interview-feedback";

const WEBSOCKET_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=AIzaSyBl-LHuzOv31rw_6DdFJYw0RJevZO_nONE`;
const AUDIO_SAMPLE_RATE = 16000;

// This worklet is for SENDING audio data from the microphone
const microphoneWorkletCode = `
  class AudioProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
      const input = inputs[0];
      if (input && input.length > 0) {
        const channelData = input[0];
        // Send the raw Float32Array data.
        this.port.postMessage(new Float32Array(channelData));
      }
      return true;
    }
  }
  registerProcessor('audio-processor', AudioProcessor);
`;

export function useLiveInterview() {
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
  const isSetupCompleteRef = useRef(false);
  const lastSpeakerRef = useRef<string | null>(null);

  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcript]);

  const playNextInQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) {
      if (!isPlayingRef.current && aiStatus === 'speaking') {
        setAiStatus('listening');
      }
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
  
        const audioData = atob(base64Audio);
        const pcm16Data = new Int16Array(audioData.length / 2);
        for (let i = 0; i < pcm16Data.length; i++) {
          const byte1 = audioData.charCodeAt(i * 2);
          const byte2 = audioData.charCodeAt(i * 2 + 1);
          pcm16Data[i] = (byte2 << 8) | byte1;
        }
  
        // Gemini audio is 24kHz, but we request 16kHz for mic. We'll play it at 24kHz.
        const audioBuffer = audioContextRef.current.createBuffer(1, pcm16Data.length, 24000);
        
        const float32Data = new Float32Array(pcm16Data.length);
        for (let i = 0; i < pcm16Data.length; i++) {
          float32Data[i] = pcm16Data[i] / 32767.0;
        }
        audioBuffer.getChannelData(0).set(float32Data);
  
        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
  
        source.onended = () => {
          isPlayingRef.current = false;
          playNextInQueue();
        };
  
        source.start();
      } catch (error) {
        console.error("Error playing audio:", error);
        isPlayingRef.current = false;
        playNextInQueue();
      }
    } else {
      isPlayingRef.current = false;
      playNextInQueue();
    }
  }, [aiStatus, setAiStatus]);
  

  const startInterview = useCallback(async () => {
    setInterviewStatus("in-progress");
    setAiStatus("thinking");
    isSetupCompleteRef.current = false;
    let workletUrl = "";

    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: AUDIO_SAMPLE_RATE,
      });

      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: AUDIO_SAMPLE_RATE,
          channelCount: 1,
        }
       });

      const blob = new Blob([microphoneWorkletCode], { type: 'application/javascript' });
      workletUrl = URL.createObjectURL(blob);
      await audioContextRef.current.audioWorklet.addModule(workletUrl);
      const workletNode = new AudioWorkletNode(audioContextRef.current, 'audio-processor');
      const source = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
      source.connect(workletNode);
      
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
              if (isSetupCompleteRef.current) {
                  try { recognitionRef.current.start(); } catch(e) {}
              }
          };
          recognitionRef.current.start();
      }

      const ws = new WebSocket(WEBSOCKET_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        const setupMessage = {
          setup: {
            model: "models/gemini-2.5-flash-native-audio-latest",
            systemInstruction: {
              parts: [
                {
                  text: `You are Echo, an AI interviewer conducting a live voice interview. Your responses will be converted to audio.
CRITICAL RULES:
1. ONLY output the exact words you are speaking out loud to the candidate.
2. NEVER output internal thoughts, instructions, or steps (e.g., do not say "Step 1: Ask about React").
3. NEVER use labels like "Question:", "Echo:", or "Interviewer:".
4. Speak naturally and conversationally, as if you are on a real phone call.
5. Start immediately by introducing yourself and asking the first question.
CONTEXT:
- Job Description: ${jobDescription}
- Candidate Resume: ${resume}`,
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
        if (!isSetupCompleteRef.current || ws.readyState !== WebSocket.OPEN || isMutedRef.current) {
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
          realtimeInput: { mediaChunks: [{ mimeType: `audio/pcm;rate=${AUDIO_SAMPLE_RATE}`, data: base64AudioData }] },
        };
        ws.send(JSON.stringify(clientContentMessage));
      };

      ws.onmessage = async (event) => {
        const response = JSON.parse(await (event.data instanceof Blob ? event.data.text() : event.data));

        if (response.setupComplete) {
            isSetupCompleteRef.current = true;
            setAiStatus("listening");
            const kickoffMessage = {
              clientContent: {
                turns: [{ role: "user", parts: [{ text: "Hello! I am ready for the interview." }] }],
                turnComplete: true
              }
            };
            ws.send(JSON.stringify(kickoffMessage));
            return;
        }

        const parts = response.serverContent?.modelTurn?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.text) {
              let textChunk = part.text
                .replace(/<think>[\s\S]*?<\/think>/gi, "")
                .replace(/^(Step \d+:|Question:|Thinking:|Thought process:|\*\*Step.*?\*\*)/gi, "").trim();

              if (textChunk) {
                if (lastSpeakerRef.current !== "AI Interviewer") {
                  addTranscriptItem({ speaker: "AI Interviewer", text: textChunk });
                  lastSpeakerRef.current = "AI Interviewer";
                } else {
                  updateLastTranscriptItem(" " + textChunk);
                }
              }
            }
            if (part.inlineData?.data) {
              audioQueueRef.current.push(part.inlineData.data);
              playNextInQueue();
            }
          }
        }
        
        if (response.serverContent?.turnComplete) {
            setAiStatus("listening");
            lastSpeakerRef.current = null;
        }

        if (response.serverContent?.interrupted) {
            audioQueueRef.current = [];
            isPlayingRef.current = false;
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket Error:", error);
        toast({ title: "Connection Error", description: "The interview service connection failed.", variant: "destructive" });
        endInterview();
      };
      ws.onclose = () => {
        if (workletUrl) URL.revokeObjectURL(workletUrl);
        endInterview();
      };

    } catch (error) {
      console.error("Failed to start interview:", error);
      toast({ title: "Setup Error", description: "Failed to initialize microphone or audio services.", variant: "destructive" });
      endInterview();
    }
  }, [jobDescription, resume, setInterviewStatus, setAiStatus, addTranscriptItem, updateLastTranscriptItem, toast, playNextInQueue]);

  const endInterview = useCallback(async () => {
    setInterviewStatus("finished");
    setAiStatus("thinking");
    
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach(track => track.stop()); mediaStreamRef.current = null; }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') { audioContextRef.current.close(); audioContextRef.current = null; }
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }

    if (transcript.length > 1) { // Only generate feedback if there was a conversation
        toast({ title: "Interview Ended", description: "Generating your feedback report..." });
        try {
          const feedbackResult = await generateInterviewFeedback({ jobDescription, resume, transcript });
          setFeedback(feedbackResult);
        } catch (error) {
          console.error("Error generating feedback:", error);
          toast({ title: "Feedback Error", description: "Could not generate feedback report.", variant: "destructive" });
        }
    }
  }, [jobDescription, resume, transcript, setAiStatus, setInterviewStatus, setFeedback, toast]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  return {
    transcriptContainerRef,
    isMuted,
    toggleMute,
    startInterview,
    endInterview
  };
}
    