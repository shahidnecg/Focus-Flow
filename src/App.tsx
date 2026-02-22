import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  FiClock,
  FiCheckCircle,
  FiCircle,
  FiPlay,
  FiPause,
  FiRefreshCcw,
  FiBell,
  FiTarget,
  FiCoffee,
  FiPlus,
  FiTrash2,
  FiEdit2,
  FiX,
  FiBarChart2,
  FiSettings,
  FiArrowRight,
  FiAlertCircle,
  FiVolume2,
  FiVolumeX,
} from "react-icons/fi";

interface Task {
  id: string;
  title: string;
  focusDuration: number;
  breakDuration: number;
  midBreakAt: number | null;
  estimatedPomodoros: number;
  completedPomodoros: number;
  status: "pending" | "in-progress" | "completed";
  createdAt: Date;
}

const useLocalStorage = <T,>(
  key: string,
  initialValue: T,
): [T, (v: T) => void] => {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const i = window.localStorage.getItem(key);
      return i ? JSON.parse(i) : initialValue;
    } catch {
      return initialValue;
    }
  });
  const setValue = (value: T) => {
    try {
      setStoredValue(value);
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.log(e);
    }
  };
  return [storedValue, setValue];
};

// ── TTS helper with proper initialization and error handling ─────────────────
const createSpeechUtterance = (
  text: string,
  rate = 0.95,
): SpeechSynthesisUtterance | null => {
  if (!window.speechSynthesis) {
    console.warn("Speech synthesis not supported");
    return null;
  }

  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.volume = 1;
    return utterance;
  } catch (e) {
    console.warn("Error creating speech utterance:", e);
    return null;
  }
};

const App: React.FC = () => {
  const [page, setPage] = useState<"landing" | "app">("landing");

  // Timer
  const [mode, setMode] = useState<"focus" | "break">("focus");
  const [isActive, setIsActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [totalTime, setTotalTime] = useState(25 * 60);
  const [completedSessions, setCompletedSessions] = useState(0);
  const [isMidBreak, setIsMidBreak] = useState(false);
  const focusTimeRemainingRef = useRef(0);

  // Tasks
  const [tasks, setTasks] = useLocalStorage<Task[]>("focusflow-v2", []);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "completed">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newFocus, setNewFocus] = useState(25);
  const [newBreak, setNewBreak] = useState(5);
  const [newMidBreakAt, setNewMidBreakAt] = useState<number | null>(null);
  const [newMidBreakEnabled, setNewMidBreakEnabled] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editFocus, setEditFocus] = useState(25);
  const [editBreak, setEditBreak] = useState(5);
  const [editMidBreakAt, setEditMidBreakAt] = useState<number | null>(null);
  const [editMidBreakEnabled, setEditMidBreakEnabled] = useState(false);

  // UI
  const [showStats, setShowStats] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toasts, setToasts] = useState<
    Array<{ id: string; msg: string; type: string }>
  >([]);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [speechSupported, setSpeechSupported] = useState(true);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const midBreakFiredRef = useRef(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check speech support
  useEffect(() => {
    if (!window.speechSynthesis) {
      setSpeechSupported(false);
      console.warn("Speech synthesis not supported in this browser");
    }
  }, []);

  // Initialize audio
  useEffect(() => {
    audioRef.current = new (
      window.AudioContext || (window as any).webkitAudioContext
    )();
    return () => {
      audioRef.current?.close();
    };
  }, []);

  // Speak function with user interaction trigger
  const speak = useCallback(
    (text: string, rate = 0.95) => {
      if (!speechEnabled || !speechSupported || !window.speechSynthesis) return;

      try {
        // Cancel any ongoing speech
        window.speechSynthesis.cancel();

        const utterance = createSpeechUtterance(text, rate);
        if (!utterance) return;

        // Try to get a good voice
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice =
          voices.find(
            (v) =>
              v.lang.includes("en") &&
              (v.name.includes("Google") ||
                v.name.includes("Samantha") ||
                v.name.includes("Daniel")),
          ) ||
          voices.find((v) => v.lang.includes("en")) ||
          voices[0];

        if (preferredVoice) utterance.voice = preferredVoice;

        // Handle errors
        utterance.onerror = (event) => {
          console.warn("Speech synthesis error:", event);
        };

        window.speechSynthesis.speak(utterance);
        console.log("[TTS] Speaking:", text);
      } catch (e) {
        console.warn("[TTS] Error:", e);
      }
    },
    [speechEnabled, speechSupported],
  );

  // Prime speech synthesis on user interaction
  const primeSpeech = useCallback(() => {
    if (!speechSupported || !window.speechSynthesis) return;

    try {
      // Create a silent utterance to initialize speech
      const utterance = createSpeechUtterance("", 1);
      if (utterance) {
        utterance.volume = 0;
        window.speechSynthesis.speak(utterance);
        window.speechSynthesis.cancel();
      }
    } catch (e) {
      console.warn("Error priming speech:", e);
    }
  }, [speechSupported]);

  // Prime speech when entering app
  useEffect(() => {
    if (page === "app") {
      primeSpeech();
    }
  }, [page, primeSpeech]);

  const playTone = useCallback((freqs: number[]) => {
    const ctx = audioRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    freqs.forEach((freq, i) => {
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      const t = now + i * 0.18;
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.01, t + 0.45);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.5);
    });
  }, []);

  // Fixed toast function with duplicate prevention
  const addToast = useCallback((msg: string, type: string) => {
    // Clear any pending toast timeout
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }

    setToasts((prev) => {
      // Check if a toast with the same message and type already exists
      const exists = prev.some((t) => t.msg === msg && t.type === type);
      if (exists) {
        console.log("Duplicate toast prevented:", msg);
        return prev;
      }

      const id = Date.now().toString();
      // Set timeout to remove this specific toast
      toastTimeoutRef.current = setTimeout(() => {
        setToasts((current) => current.filter((t) => t.id !== id));
      }, 4000);

      return [...prev, { id, msg, type }];
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const fmt = (s: number) =>
    `${Math.floor(s / 60)
      .toString()
      .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  const progress = totalTime > 0 ? 1 - timeLeft / totalTime : 0;

  // NumInput component
  const NumInput: React.FC<{
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    label: string;
    placeholder?: string;
  }> = ({ value, onChange, min = 1, max = 99, label, placeholder }) => {
    const [raw, setRaw] = useState(String(value));
    useEffect(() => setRaw(String(value)), [value]);
    const commit = (s: string) => {
      const d = s.replace(/\D/g, "").slice(0, 2);
      const n = parseInt(d, 10);
      const c = !d || isNaN(n) ? min : Math.min(Math.max(n, min), max);
      setRaw(String(c));
      onChange(c);
    };
    return (
      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
          {label}
        </label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={2}
          value={raw}
          placeholder={placeholder}
          onChange={(e) =>
            setRaw(e.target.value.replace(/\D/g, "").slice(0, 2))
          }
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
            if (
              !/^\d$/.test(e.key) &&
              ![
                "Backspace",
                "Delete",
                "ArrowLeft",
                "ArrowRight",
                "Tab",
              ].includes(e.key)
            )
              e.preventDefault();
          }}
          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center font-mono text-base font-bold text-slate-800 transition"
        />
      </div>
    );
  };

  // Ring component
  const Ring: React.FC<{
    progress: number;
    mode: "focus" | "break";
    size?: number;
  }> = ({ progress, mode, size = 220 }) => {
    const r = (size - 20) / 2;
    const circ = 2 * Math.PI * r;
    const dash = circ * (1 - progress);
    return (
      <svg width={size} height={size} className="rotate-[-90deg]">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={10}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={mode === "focus" ? "#3b82f6" : "#10b981"}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={dash}
          style={{ transition: "stroke-dashoffset 0.9s linear" }}
        />
      </svg>
    );
  };

  // Toast component
  const Toast: React.FC<{ msg: string; type: string; onClose: () => void }> = ({
    msg,
    type,
    onClose,
  }) => (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl text-white text-sm font-medium min-w-[280px] animate-slideIn
      ${type === "break" ? "bg-emerald-600" : type === "focus" ? "bg-blue-600" : type === "success" ? "bg-violet-600" : "bg-slate-700"}`}
    >
      <span className="flex-1">{msg}</span>
      <button onClick={onClose} className="opacity-70 hover:opacity-100">
        <FiX size={14} />
      </button>
    </div>
  );

  // Start mid-session break
  const startMidBreak = useCallback(
    (task: Task, manual = false) => {
      setIsActive(false);
      focusTimeRemainingRef.current = timeLeft;
      setIsMidBreak(true);
      setMode("break");
      const bd = task.breakDuration * 60;
      setTimeLeft(bd);
      setTotalTime(bd);
      midBreakFiredRef.current = true;
      playTone([523.25, 659.25]);
      speak(
        `${manual ? "Taking a break now." : "Time for your scheduled break."} ${task.breakDuration} minutes. Enjoy!`,
      );
      addToast(
        `☕ ${manual ? "Break started!" : "Scheduled break!"} ${task.breakDuration} min`,
        "break",
      );
      setIsActive(true);
    },
    [timeLeft, playTone, addToast, speak],
  );

  // Timer tick
  useEffect(() => {
    if (isActive && selectedTask) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          // Check mid-break trigger
          if (
            mode === "focus" &&
            !isMidBreak &&
            !midBreakFiredRef.current &&
            selectedTask.midBreakAt !== null &&
            selectedTask.midBreakAt !== undefined
          ) {
            const elapsed = totalTime - prev + 1;
            const triggerSec = selectedTask.midBreakAt * 60;
            if (elapsed >= triggerSec) {
              setTimeout(() => startMidBreak(selectedTask, false), 0);
              return prev;
            }
          }

          if (prev <= 1) {
            setIsActive(false);

            if (mode === "break" && isMidBreak) {
              // Mid-break over → resume focus
              playTone([392, 493.88, 587.33]);
              speak(
                `Break time is over. Let's get back to focusing on ${selectedTask.title}!`,
              );
              addToast("🎯 Break over! Back to focus!", "focus");
              setIsMidBreak(false);
              midBreakFiredRef.current = false;
              const remaining = focusTimeRemainingRef.current;
              setMode("focus");
              setTimeLeft(remaining);
              setTotalTime(remaining);
              setIsActive(true);
              return 0;
            } else if (mode === "focus") {
              // Full focus session complete
              setCompletedSessions((s) => s + 1);
              playTone([523.25, 659.25]);
              speak(
                `Focus time complete for ${selectedTask.title}. Time for a ${selectedTask.breakDuration} minute break!`,
              );
              addToast(
                `🎯 Focus complete! ${selectedTask.breakDuration} min break starting.`,
                "break",
              );

              const updated = tasks.map((t) => {
                if (t.id !== selectedTask.id) return t;
                const cp = (t.completedPomodoros || 0) + 1;
                const status: "completed" | "in-progress" =
                  cp >= t.estimatedPomodoros ? "completed" : "in-progress";
                if (status === "completed") {
                  speak(
                    `Congratulations! You've completed the task: ${t.title}`,
                  );
                  addToast(`✅ "${t.title}" completed!`, "success");
                }
                return { ...t, completedPomodoros: cp, status };
              });
              setTasks(updated);
              setSelectedTask(
                updated.find((t) => t.id === selectedTask.id) || null,
              );
              midBreakFiredRef.current = false;
              setIsMidBreak(false);
              setMode("break");
              const bd = selectedTask.breakDuration * 60;
              setTimeLeft(bd);
              setTotalTime(bd);
              setIsActive(true);
              return 0;
            } else {
              // Full break session complete
              playTone([392, 493.88, 587.33]);
              speak(`Break time is over. Let's get back to focus!`);
              addToast("⏰ Break over! Ready to focus?", "focus");
              midBreakFiredRef.current = false;
              setIsMidBreak(false);
              setMode("focus");
              const fd = selectedTask.focusDuration * 60;
              setTimeLeft(fd);
              setTotalTime(fd);
              return 0;
            }
          }
          return prev - 1;
        });
      }, 1000);
    } else if (timerRef.current) clearInterval(timerRef.current);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [
    isActive,
    mode,
    selectedTask,
    tasks,
    isMidBreak,
    totalTime,
    setTasks,
    playTone,
    addToast,
    startMidBreak,
    speak,
  ]);

  const resetTimer = () => {
    setIsActive(false);
    setIsMidBreak(false);
    midBreakFiredRef.current = false;
    focusTimeRemainingRef.current = 0;
    if (selectedTask) {
      setMode("focus");
      const fd = selectedTask.focusDuration * 60;
      setTimeLeft(fd);
      setTotalTime(fd);
    }
  };

  const handleManualBreak = () => {
    if (!selectedTask || mode !== "focus" || !isActive) return;
    startMidBreak(selectedTask, true);
  };

  // Task management
  const addTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const t: Task = {
      id: Date.now().toString(),
      title: newTitle,
      focusDuration: newFocus,
      breakDuration: newBreak,
      midBreakAt:
        newMidBreakEnabled && newMidBreakAt !== null ? newMidBreakAt : null,
      estimatedPomodoros: 1,
      completedPomodoros: 0,
      status: "pending",
      createdAt: new Date(),
    };
    setTasks([...tasks, t]);
    setNewTitle("");
    setNewFocus(25);
    setNewBreak(5);
    setNewMidBreakAt(null);
    setNewMidBreakEnabled(false);
    setShowAdd(false);
    speak(`Task added: ${newTitle}`);
    addToast("📝 Task added!", "success");
  };

  const deleteTask = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    setTasks(tasks.filter((t) => t.id !== id));
    if (selectedTask?.id === id) setSelectedTask(null);
    if (task) speak(`Task deleted: ${task.title}`);
    addToast("🗑️ Task deleted", "info");
  };

  const toggleDone = (id: string) => {
    setTasks(
      tasks.map((t) =>
        t.id === id
          ? { ...t, status: t.status === "completed" ? "pending" : "completed" }
          : t,
      ),
    );
  };

  const selectTask = (task: Task) => {
    if (selectedTask?.id === task.id) return;
    setIsActive(false);
    setIsMidBreak(false);
    midBreakFiredRef.current = false;
    setSelectedTask(task);
    setMode("focus");
    const fd = task.focusDuration * 60;
    setTimeLeft(fd);
    setTotalTime(fd);
    speak(`Selected task: ${task.title}`);
    addToast(`✔ Selected: ${task.title}`, "info");
  };

  const startEdit = (t: Task) => {
    setEditId(t.id);
    setEditTitle(t.title);
    setEditFocus(t.focusDuration);
    setEditBreak(t.breakDuration);
    setEditMidBreakAt(t.midBreakAt);
    setEditMidBreakEnabled(t.midBreakAt !== null);
  };

  const saveEdit = (id: string) => {
    if (!editTitle.trim()) return;
    const upd = tasks.map((t) =>
      t.id === id
        ? {
            ...t,
            title: editTitle,
            focusDuration: editFocus,
            breakDuration: editBreak,
            midBreakAt:
              editMidBreakEnabled && editMidBreakAt !== null
                ? editMidBreakAt
                : null,
          }
        : t,
    );
    setTasks(upd);
    if (selectedTask?.id === id) {
      const u = upd.find((t) => t.id === id)!;
      setSelectedTask(u);
      setTimeLeft(u.focusDuration * 60);
      setTotalTime(u.focusDuration * 60);
    }
    setEditId(null);
    speak(`Task updated: ${editTitle}`);
    addToast("Task updated", "success");
  };

  const filtered = tasks.filter((t) =>
    filter === "pending"
      ? t.status !== "completed"
      : filter === "completed"
        ? t.status === "completed"
        : true,
  );
  const totalPom = tasks.reduce((s, t) => s + (t.completedPomodoros || 0), 0);
  const doneTasks = tasks.filter((t) => t.status === "completed").length;
  const pendTasks = tasks.filter((t) => t.status !== "completed").length;

  // Landing page
  if (page === "landing")
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
        <style>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)} }
        @keyframes float  { 0%,100%{transform:translateY(0)}50%{transform:translateY(-18px)} }
        @keyframes slideIn{ from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1} }
        .fu{animation:fadeUp .7s ease forwards}
        .fl{animation:float 4s ease-in-out infinite}
        .d1{animation-delay:.15s;opacity:0}.d2{animation-delay:.3s;opacity:0}.d3{animation-delay:.45s;opacity:0}
        .animate-slideIn{animation:slideIn .35s ease-out}
        .glass{background:rgba(255,255,255,.06);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.12)}
      `}</style>

        <nav className="container mx-auto px-6 py-5 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-blue-500 rounded-xl flex items-center justify-center">
              <FiTarget className="text-white text-lg" />
            </div>
            <span className="text-xl font-bold text-white tracking-tight">
              FocusFlow
            </span>
          </div>
          <button
            onClick={() => setPage("app")}
            className="bg-blue-500 hover:bg-blue-400 text-white px-5 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2"
          >
            Launch App <FiArrowRight />
          </button>
        </nav>

        <div className="container mx-auto px-6 py-20 grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-blue-500/20 text-blue-300 px-4 py-1.5 rounded-full text-sm font-medium mb-6 fu">
              <FiBell size={14} /> MCA Mini Project — Pomodoro Timer
            </div>
            <h1 className="text-5xl lg:text-6xl font-extrabold text-white leading-tight mb-6 fu d1">
              Deep Work,
              <br />
              <span className="text-blue-400">Effortless Flow</span>
            </h1>
            <p className="text-lg text-slate-300 mb-8 fu d2 leading-relaxed">
              Intelligent task-linked timers with voice notifications, scheduled
              mid-session breaks, and real-time progress tracking.
            </p>
            <div className="flex gap-3 fu d3">
              <button
                onClick={() => setPage("app")}
                className="bg-blue-500 hover:bg-blue-400 text-white px-7 py-3 rounded-xl font-semibold flex items-center gap-2 transition"
              >
                Get Started <FiArrowRight />
              </button>
              <button className="glass text-white px-7 py-3 rounded-xl font-semibold hover:bg-white/10 transition">
                Learn More
              </button>
            </div>
            <div className="flex gap-10 mt-14 fu d3">
              {[
                ["10K+", "Users"],
                ["50K+", "Tasks Done"],
                ["4.8★", "Rating"],
              ].map(([v, l]) => (
                <div key={l}>
                  <div className="text-2xl font-bold text-white">{v}</div>
                  <div className="text-slate-400 text-sm">{l}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="fl">
            <div className="glass rounded-3xl p-8">
              <div className="text-center text-white mb-4">
                <div className="text-6xl font-mono font-black mb-2">25:00</div>
                <div className="flex justify-center gap-2 mb-4">
                  <span className="px-3 py-1 bg-blue-500/30 text-blue-300 rounded-full text-xs font-semibold">
                    FOCUS
                  </span>
                  <span className="px-3 py-1 bg-emerald-500/20 text-emerald-300 rounded-full text-xs font-semibold">
                    BREAK
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                {[
                  "Design landing page",
                  "Write report section",
                  "Review codebase",
                ].map((t, i) => (
                  <div
                    key={t}
                    className="glass rounded-xl px-4 py-2.5 flex items-center gap-3"
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${i === 0 ? "bg-blue-400" : i === 1 ? "bg-emerald-400" : "bg-slate-500"}`}
                    />
                    <span
                      className={`text-sm ${i === 2 ? "text-slate-400 line-through" : "text-white"}`}
                    >
                      {t}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="bg-white py-20">
          <div className="container mx-auto px-6">
            <h2 className="text-3xl font-bold text-center text-slate-800 mb-2">
              Why FocusFlow?
            </h2>
            <p className="text-slate-500 text-center mb-12">
              Built for deep focus sessions with full control
            </p>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  icon: FiClock,
                  color: "blue",
                  title: "Task-linked Timers",
                  desc: "Each task has its own focus and break durations, fully customizable.",
                },
                {
                  icon: FiCoffee,
                  color: "emerald",
                  title: "Mid-session Breaks",
                  desc: "Schedule a break at any point during focus, or take one on demand.",
                },
                {
                  icon: FiBell,
                  color: "violet",
                  title: "Voice Announcements",
                  desc: "Hear your task name and status when timers complete — hands-free.",
                },
              ].map(({ icon: Icon, color, title, desc }) => (
                <div
                  key={title}
                  className="bg-slate-50 rounded-2xl p-7 hover:shadow-md transition"
                >
                  <div
                    className={`w-12 h-12 bg-${color}-100 rounded-xl flex items-center justify-center mb-4`}
                  >
                    <Icon className={`text-${color}-600 text-xl`} />
                  </div>
                  <h3 className="font-semibold text-slate-800 mb-2">{title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">
                    {desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="bg-slate-950 text-slate-400 py-8 text-center text-sm">
          © 2026 FocusFlow — MCA Mini Project · Team-Elite{" "}
          <span style={{ color: "yellow" }}>⚡</span>·
        </footer>
      </div>
    );

  // ── APP ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-100">
      <style>{`
        @keyframes slideIn{from{transform:translateX(110%);opacity:0}to{transform:translateX(0);opacity:1}}
        @keyframes fadeIn {from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
        .animate-slideIn{animation:slideIn .3s ease-out}
        .animate-fadeIn {animation:fadeIn .25s ease-out}
        .custom-scrollbar::-webkit-scrollbar{width:4px}
        .custom-scrollbar::-webkit-scrollbar-track{background:#f1f5f9;border-radius:9px}
        .custom-scrollbar::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:9px}
      `}</style>

      {/* Toasts - Fixed duplicate prevention */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <Toast
            key={t.id}
            msg={t.msg}
            type={t.type}
            onClose={() => removeToast(t.id)}
          />
        ))}
      </div>

      {/* Speech Status Bar */}
      {!speechSupported && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-amber-100 text-amber-800 px-4 py-2 rounded-full text-xs font-medium shadow-lg z-50">
          ⚠️ Speech not supported in this browser
        </div>
      )}

      {/* Stats modal */}
      {showStats && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setShowStats(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-5">
              <h3 className="font-bold text-slate-800 text-lg">Statistics</h3>
              <button
                onClick={() => setShowStats(false)}
                className="p-1.5 hover:bg-slate-100 rounded-lg"
              >
                <FiX className="text-slate-500" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { v: totalPom, l: "Pomodoros", c: "blue" },
                { v: doneTasks, l: "Completed", c: "emerald" },
                { v: pendTasks, l: "Pending", c: "amber" },
                { v: completedSessions, l: "Sessions", c: "violet" },
              ].map(({ v, l, c }) => (
                <div
                  key={l}
                  className={`bg-${c}-50 rounded-xl p-4 text-center`}
                >
                  <div className={`text-2xl font-bold text-${c}-700`}>{v}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{l}</div>
                </div>
              ))}
            </div>
            <div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{
                    width: `${tasks.length ? (doneTasks / tasks.length) * 100 : 0}%`,
                  }}
                />
              </div>
              <p className="text-center text-xs text-slate-500 mt-2">
                {tasks.length
                  ? Math.round((doneTasks / tasks.length) * 100)
                  : 0}
                % complete
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Settings modal */}
      {showSettings && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setShowSettings(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-slate-800 text-lg">Settings</h3>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1.5 hover:bg-slate-100 rounded-lg"
              >
                <FiX className="text-slate-500" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="bg-blue-50 rounded-xl p-4">
                <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                  <FiVolume2 /> Voice Announcements
                </h4>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">
                    Enable voice notifications
                  </span>
                  <button
                    onClick={() => {
                      setSpeechEnabled(!speechEnabled);
                      if (!speechEnabled) primeSpeech();
                    }}
                    className={`p-2 rounded-lg transition-colors ${
                      speechEnabled
                        ? "bg-blue-600 text-white"
                        : "bg-slate-200 text-slate-600"
                    }`}
                    disabled={!speechSupported}
                  >
                    {speechEnabled ? (
                      <FiVolume2 size={18} />
                    ) : (
                      <FiVolumeX size={18} />
                    )}
                  </button>
                </div>
                {!speechSupported && (
                  <p className="text-xs text-amber-600 mt-2">
                    Speech not supported in this browser
                  </p>
                )}
              </div>

              <div className="bg-slate-50 rounded-xl p-4">
                <h4 className="font-semibold text-slate-800 mb-2">
                  About Project
                </h4>
                <p className="text-sm text-slate-600">
                  FocusFlow — MCA Mini Project
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  Team-Elite
                  <span style={{ color: "yellow" }}>⚡</span>
                  <br />
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-5 py-3.5 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPage("landing")}
              className="text-slate-400 hover:text-slate-700 transition p-1.5 hover:bg-slate-100 rounded-lg"
            >
              <FiArrowRight className="rotate-180" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                <FiTarget className="text-white text-sm" />
              </div>
              <div>
                <span className="font-bold text-slate-800 text-base leading-none block">
                  FocusFlow
                </span>
                <span className="text-xs text-slate-400">
                  Pomodoro Task Manager
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {speechEnabled && speechSupported && (
              <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full flex items-center gap-1 mr-1">
                <FiVolume2 size={11} /> Voice On
              </span>
            )}
            <button
              onClick={() => setShowStats(true)}
              className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition"
            >
              <FiBarChart2 size={18} />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition"
            >
              <FiSettings size={18} />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 grid lg:grid-cols-[1fr_1.1fr] gap-6">
        {/* ── TIMER PANEL ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
              <FiClock className="text-blue-500" /> Timer
            </h2>
            {selectedTask && (
              <div className="flex gap-1.5">
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                    mode === "focus"
                      ? "bg-blue-100 text-blue-700"
                      : isMidBreak
                        ? "bg-amber-100 text-amber-700"
                        : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {mode === "focus"
                    ? "● FOCUS"
                    : isMidBreak
                      ? "⏸ MID-BREAK"
                      : "☕ BREAK"}
                </span>
              </div>
            )}
          </div>

          {/* Ring + time */}
          <div className="flex flex-col items-center justify-center flex-1 py-4">
            <div className="relative inline-flex items-center justify-center mb-6">
              <Ring progress={progress} mode={mode} size={200} />
              <div className="absolute text-center">
                <div className="text-5xl font-black font-mono text-slate-800 leading-none">
                  {fmt(timeLeft)}
                </div>
                <div className="text-xs text-slate-400 mt-1 font-medium uppercase tracking-wider">
                  {!selectedTask
                    ? "Select a task"
                    : mode === "focus"
                      ? `${selectedTask.title}`
                      : "Break"}
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  if (selectedTask) {
                    setIsActive((a) => !a);
                    if (!isActive) {
                      // Prime speech on start
                      primeSpeech();
                    }
                  }
                }}
                disabled={!selectedTask}
                className={`flex items-center gap-2 px-7 py-3 rounded-xl font-semibold text-sm transition shadow-sm ${
                  !selectedTask
                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                    : isActive
                      ? "bg-amber-500 hover:bg-amber-400 text-white"
                      : "bg-blue-500 hover:bg-blue-400 text-white"
                }`}
              >
                {isActive ? <FiPause /> : <FiPlay />}
                {isActive ? "Pause" : "Start"}
              </button>

              <button
                onClick={resetTimer}
                disabled={!selectedTask}
                className={`p-3 rounded-xl font-semibold transition border ${
                  !selectedTask
                    ? "border-slate-200 text-slate-300 cursor-not-allowed"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
                title="Reset"
              >
                <FiRefreshCcw size={16} />
              </button>

              {/* Manual break button */}
              <button
                onClick={handleManualBreak}
                disabled={!selectedTask || !isActive || mode !== "focus"}
                title="Take a break now"
                className={`flex items-center gap-1.5 px-4 py-3 rounded-xl text-sm font-semibold transition border ${
                  selectedTask && isActive && mode === "focus"
                    ? "border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                    : "border-slate-200 text-slate-300 cursor-not-allowed"
                }`}
              >
                <FiCoffee size={14} /> Break
              </button>
            </div>

            {/* Manual break hint */}
            {selectedTask && isActive && mode === "focus" && (
              <p className="text-xs text-slate-400 mt-3 flex items-center gap-1">
                <FiAlertCircle size={11} /> Click "Break" to pause focus and
                take a break now
              </p>
            )}
          </div>

          {/* Task progress */}
          {selectedTask && (
            <div className="border-t border-slate-100 pt-4 mt-2">
              <div className="flex justify-between items-center mb-2">
                <div>
                  <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                    Current Task
                  </p>
                  <p className="font-semibold text-slate-700 text-sm mt-0.5">
                    {selectedTask.title}
                  </p>
                </div>
                <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                  {selectedTask.completedPomodoros}/
                  {selectedTask.estimatedPomodoros}
                </span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{
                    width: `${((selectedTask.completedPomodoros || 0) / selectedTask.estimatedPomodoros) * 100}%`,
                  }}
                />
              </div>
              {selectedTask.midBreakAt !== null && (
                <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                  <FiBell size={11} /> Auto-break scheduled at{" "}
                  {selectedTask.midBreakAt} min mark
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── TASKS PANEL ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col">
          <div className="flex justify-between items-center mb-5">
            <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
              <FiCheckCircle className="text-blue-500" /> Tasks
            </h2>
            <button
              onClick={() => {
                setShowAdd((a) => !a);
                primeSpeech();
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-500 hover:bg-blue-400 text-white rounded-xl text-sm font-semibold transition"
            >
              <FiPlus size={14} /> New Task
            </button>
          </div>

          {/* Add form */}
          {showAdd && (
            <form
              onSubmit={addTask}
              className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200 animate-fadeIn"
            >
              <p className="text-sm font-semibold text-slate-700 mb-3">
                New Task
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Task Title
                  </label>
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="What will you focus on?"
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <NumInput
                    label="Focus (min)"
                    value={newFocus}
                    onChange={setNewFocus}
                    min={1}
                    max={99}
                  />
                  <NumInput
                    label="Break (min)"
                    value={newBreak}
                    onChange={setNewBreak}
                    min={1}
                    max={30}
                  />
                </div>

                {/* Mid-break schedule */}
                <div className="bg-amber-50 rounded-lg p-3 border border-amber-100">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={newMidBreakEnabled}
                      onChange={(e) => setNewMidBreakEnabled(e.target.checked)}
                      className="w-4 h-4 accent-amber-500 rounded"
                    />
                    <span className="text-xs font-semibold text-amber-700">
                      Schedule mid-focus break
                    </span>
                  </label>
                  {newMidBreakEnabled && (
                    <div className="mt-2">
                      <NumInput
                        label={`Take break at minute (max ${newFocus - 1})`}
                        value={newMidBreakAt ?? 1}
                        onChange={(v) =>
                          setNewMidBreakAt(Math.min(v, newFocus - 1))
                        }
                        min={1}
                        max={newFocus - 1}
                      />
                      <p className="text-xs text-amber-600 mt-1.5">
                        e.g. focus = {newFocus} min, break at min{" "}
                        {newMidBreakAt ?? 1} → {newBreak} min break → resume for{" "}
                        {newFocus - (newMidBreakAt ?? 1)} more min
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-blue-500 hover:bg-blue-400 text-white rounded-xl text-sm font-semibold transition"
                  >
                    Add Task
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAdd(false)}
                    className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-200 transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Filter tabs */}
          <div className="flex gap-1.5 mb-4">
            {(["all", "pending", "completed"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
                  filter === f
                    ? "bg-blue-500 text-white"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Task list */}
          <div className="space-y-2 flex-1 overflow-y-auto custom-scrollbar pr-1">
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <div className="text-4xl mb-3">📋</div>
                <p className="text-sm">No tasks yet</p>
                <button
                  onClick={() => {
                    setShowAdd(true);
                    primeSpeech();
                  }}
                  className="mt-2 text-blue-500 text-sm hover:underline"
                >
                  Add your first task
                </button>
              </div>
            ) : (
              filtered.map((task) => (
                <div
                  key={task.id}
                  className={`rounded-xl border transition ${
                    selectedTask?.id === task.id
                      ? "border-blue-300 bg-blue-50"
                      : "border-slate-100 bg-slate-50 hover:border-slate-200 hover:bg-white"
                  }`}
                >
                  {editId === task.id ? (
                    <div className="p-3 space-y-2 animate-fadeIn">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <NumInput
                          label="Focus (min)"
                          value={editFocus}
                          onChange={setEditFocus}
                          min={1}
                          max={99}
                        />
                        <NumInput
                          label="Break (min)"
                          value={editBreak}
                          onChange={setEditBreak}
                          min={1}
                          max={30}
                        />
                      </div>
                      <div className="bg-amber-50 rounded-lg p-3 border border-amber-100">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editMidBreakEnabled}
                            onChange={(e) =>
                              setEditMidBreakEnabled(e.target.checked)
                            }
                            className="accent-amber-500"
                          />
                          <span className="text-xs font-semibold text-amber-700">
                            Mid-focus break
                          </span>
                        </label>
                        {editMidBreakEnabled && (
                          <div className="mt-2">
                            <NumInput
                              label={`Break at min (max ${editFocus - 1})`}
                              value={editMidBreakAt ?? 1}
                              onChange={(v) =>
                                setEditMidBreakAt(Math.min(v, editFocus - 1))
                              }
                              min={1}
                              max={editFocus - 1}
                            />
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(task.id)}
                          className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-400 text-white rounded-lg text-xs font-semibold transition"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="flex-1 py-2 bg-slate-200 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-300 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 flex items-start gap-3">
                      <button
                        onClick={() => toggleDone(task.id)}
                        className="mt-0.5 text-lg shrink-0"
                      >
                        {task.status === "completed" ? (
                          <FiCheckCircle className="text-emerald-500" />
                        ) : (
                          <FiCircle className="text-slate-300 hover:text-blue-400 transition" />
                        )}
                      </button>
                      <div
                        className="flex-1 cursor-pointer min-w-0"
                        onClick={() => selectTask(task)}
                      >
                        <p
                          className={`text-sm font-medium truncate ${task.status === "completed" ? "line-through text-slate-400" : "text-slate-700"}`}
                        >
                          {task.title}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          <span className="text-xs text-slate-400">
                            🎯 {task.focusDuration}m
                          </span>
                          <span className="text-xs text-slate-400">
                            ☕ {task.breakDuration}m
                          </span>
                          {task.midBreakAt !== null && (
                            <span className="text-xs text-amber-500 font-medium">
                              ⏱ break@{task.midBreakAt}m
                            </span>
                          )}
                          <span className="text-xs text-slate-400">
                            {task.completedPomodoros}/{task.estimatedPomodoros}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => startEdit(task)}
                          className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition"
                        >
                          <FiEdit2 size={12} />
                        </button>
                        <button
                          onClick={() => deleteTask(task.id)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                        >
                          <FiTrash2 size={12} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {tasks.length > 0 && (
            <div className="border-t border-slate-100 mt-4 pt-4 grid grid-cols-3 text-center text-sm gap-2">
              {[
                { v: tasks.length, l: "Total", c: "slate" },
                { v: doneTasks, l: "Done", c: "emerald" },
                { v: pendTasks, l: "Pending", c: "amber" },
              ].map(({ v, l, c }) => (
                <div key={l}>
                  <div className={`font-bold text-${c}-600 text-base`}>{v}</div>
                  <div className="text-slate-400 text-xs">{l}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <footer className="text-center py-4 text-xs text-slate-400">
        FocusFlow — MCA Mini Project · Team-Elite
        <span style={{ color: "yellow" }}>⚡</span>
      </footer>
    </div>
  );
};

export default App;
