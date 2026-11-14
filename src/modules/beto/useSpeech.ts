/**
 * Dictado por voz con el reconocimiento del navegador (Chrome, Edge, Safari).
 * Sin soporte, `supported` es false y la app oculta el micrófono.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** onText recibe el texto dictado (parcial y final) para ponerlo en la caja. */
export function useSpeech(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const callback = useRef(onText);
  callback.current = onText;
  const supported = recognitionCtor() !== null;

  const stop = useCallback(() => {
    recognition.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "es-VE";
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      callback.current(text.trim());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognition.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, []);

  useEffect(() => () => recognition.current?.stop(), []);

  return { supported, listening, start, stop, toggle: listening ? stop : start };
}
